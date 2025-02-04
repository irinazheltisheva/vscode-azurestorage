/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorageShare from '@azure/storage-file-share';
import * as mime from 'mime';
import { posix } from 'path';
import { ProgressLocation, window } from "vscode";
import { AzureParentTreeItem, ICreateChildImplContext } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { IFileShareCreateChildContext } from "../tree/fileShare/FileShareTreeItem";
import { FileTreeItem } from "../tree/fileShare/FileTreeItem";
import { IStorageRoot } from "../tree/IStorageRoot";
import { doesDirectoryExist } from './directoryUtils';
import { localize } from './localize';
import { validateFileOrDirectoryName } from './validateNames';

export function createShareClient(root: IStorageRoot, shareName: string): azureStorageShare.ShareClient {
    const shareServiceClient: azureStorageShare.ShareServiceClient = root.createShareServiceClient();
    return shareServiceClient.getShareClient(shareName);
}

export function createDirectoryClient(root: IStorageRoot, shareName: string, directoryName: string): azureStorageShare.ShareDirectoryClient {
    const shareClient: azureStorageShare.ShareClient = createShareClient(root, shareName);
    return shareClient.getDirectoryClient(directoryName);
}

export function createFileClient(root: IStorageRoot, shareName: string, directoryName: string, fileName: string): azureStorageShare.ShareFileClient {
    const directoryClient: azureStorageShare.ShareDirectoryClient = createDirectoryClient(root, shareName, directoryName);
    return directoryClient.getFileClient(fileName);
}

export async function askAndCreateEmptyTextFile(parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, shareName: string, context: ICreateChildImplContext & IFileShareCreateChildContext): Promise<FileTreeItem> {
    const fileName: string = context.childName || await getFileOrDirectoryName(parent, directoryPath, shareName);
    return await window.withProgress({ location: ProgressLocation.Window }, async (progress) => {
        context.showCreatingTreeItem(fileName);
        progress.report({ message: `Azure Storage: Creating file '${fileName}'` });
        await createFile(directoryPath, fileName, shareName, parent.root);
        return new FileTreeItem(parent, fileName, directoryPath, shareName);
    });
}

export async function getFileOrDirectoryName(parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, shareName: string, value?: string): Promise<string> {
    return await ext.ui.showInputBox({
        value,
        placeHolder: localize('enterName', 'Enter a name for the new resource'),
        validateInput: async (name: string) => {
            let nameError: string | undefined = validateFileOrDirectoryName(name);
            if (nameError) {
                return nameError;
            } else if (await doesFileExist(name, parent, directoryPath, shareName) || await doesDirectoryExist(parent, posix.join(directoryPath, name), shareName)) {
                return localize('alreadyExists', 'A file or directory named "{0}" already exists', name);
            }
            return undefined;
        }
    });
}

export async function doesFileExist(fileName: string, parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, shareName: string): Promise<boolean> {
    const fileService: azureStorageShare.ShareFileClient = createFileClient(parent.root, shareName, directoryPath, fileName);
    try {
        await fileService.getProperties();
        return true;
    } catch {
        return false;
    }
}

export async function createFile(directoryPath: string, name: string, shareName: string, root: IStorageRoot, options?: azureStorageShare.FileCreateOptions): Promise<azureStorageShare.FileCreateResponse> {
    const fileClient: azureStorageShare.ShareFileClient = createFileClient(root, shareName, directoryPath, name);

    // tslint:disable: strict-boolean-expressions
    options = options || {};
    options.fileHttpHeaders = options.fileHttpHeaders || {};
    options.fileHttpHeaders.fileContentType = options.fileHttpHeaders.fileContentType || mime.getType(name) || undefined;
    // tslint:enable: strict-boolean-expressions

    return await fileClient.create(0, options);
}

export async function updateFileFromText(directoryPath: string, name: string, shareName: string, root: IStorageRoot, text: string | Buffer): Promise<void> {
    const fileClient: azureStorageShare.ShareFileClient = createFileClient(root, shareName, directoryPath, name);
    let options: azureStorageShare.FileParallelUploadOptions = await getExistingCreateOptions(directoryPath, name, shareName, root);
    // tslint:disable: strict-boolean-expressions
    options = options || {};
    options.fileHttpHeaders = options.fileHttpHeaders || {};
    options.fileHttpHeaders.fileContentType = options.fileHttpHeaders.fileContentType || mime.getType(name) || undefined;
    // tslint:enable: strict-boolean-expressions
    await fileClient.uploadData(Buffer.from(text), options);
}

export async function deleteFile(directory: string, name: string, share: string, root: IStorageRoot): Promise<void> {
    const fileClient = createFileClient(root, share, directory, name);
    await fileClient.delete();
}

// Gets existing create options using the `@azure/storage-file-share` SDK
export async function getExistingCreateOptions(directoryPath: string, name: string, shareName: string, root: IStorageRoot): Promise<azureStorageShare.FileCreateOptions> {
    const fileClient: azureStorageShare.ShareFileClient = createFileClient(root, shareName, directoryPath, name);
    let propertiesResult: azureStorageShare.FileGetPropertiesResponse = await fileClient.getProperties();
    let options: azureStorageShare.FileCreateOptions = {};
    options.fileHttpHeaders = {};
    options.fileHttpHeaders.fileCacheControl = propertiesResult.cacheControl;
    options.fileHttpHeaders.fileContentDisposition = propertiesResult.contentDisposition;
    options.fileHttpHeaders.fileContentEncoding = propertiesResult.contentEncoding;
    options.fileHttpHeaders.fileContentLanguage = propertiesResult.contentLanguage;
    options.fileHttpHeaders.fileContentMD5 = undefined; // Don't allow the existing MD5 hash to be used for the updated file
    options.fileHttpHeaders.fileContentType = propertiesResult.contentType;
    options.metadata = propertiesResult.metadata;
    return options;
}
