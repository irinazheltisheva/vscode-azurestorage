/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorageBlob from "@azure/storage-blob";
import * as path from 'path';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, DialogResponses, IActionContext, ICreateChildImplContext, parseError } from "vscode-azureextensionui";
import { AzureStorageFS } from "../../AzureStorageFS";
import { getResourcesPath } from "../../constants";
import { ext } from "../../extensionVariables";
import { createBlobClient, createChildAsNewBlockBlob, IBlobContainerCreateChildContext, loadMoreBlobChildren } from '../../utils/blobUtils';
import { localize } from "../../utils/localize";
import { ICopyUrl } from "../ICopyUrl";
import { IStorageRoot } from "../IStorageRoot";
import { BlobContainerTreeItem } from "./BlobContainerTreeItem";
import { BlobTreeItem, ISuppressMessageContext } from "./BlobTreeItem";

export class BlobDirectoryTreeItem extends AzureParentTreeItem<IStorageRoot> implements ICopyUrl {
    public static contextValue: string = 'azureBlobDirectory';
    public contextValue: string = BlobDirectoryTreeItem.contextValue;
    public iconPath: { light: string | vscode.Uri; dark: string | vscode.Uri } = {
        light: path.join(getResourcesPath(), 'light', 'folder.svg'),
        dark: path.join(getResourcesPath(), 'dark', 'folder.svg')
    };

    /**
     * The name (and only the name) of the directory
     */
    public readonly dirName: string;

    /**
     * The full path of the directory within the container. This will always end in `/`
     */
    public readonly dirPath: string;

    private _continuationToken: string | undefined;

    constructor(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, dirPath: string, public container: azureStorageBlob.ContainerItem) {
        super(parent);
        if (!dirPath.endsWith(path.posix.sep)) {
            dirPath += path.posix.sep;
        }

        this.dirPath = dirPath;
        this.dirName = path.basename(dirPath);
    }

    public get label(): string {
        return this.dirName;
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this._continuationToken;
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._continuationToken = undefined;
        }

        let { children, continuationToken } = await loadMoreBlobChildren(this, this._continuationToken);
        this._continuationToken = continuationToken;
        return children;
    }

    public async createChildImpl(context: ICreateChildImplContext & IBlobContainerCreateChildContext): Promise<AzExtTreeItem> {
        let child: AzExtTreeItem;
        if (context.childType === BlobTreeItem.contextValue) {
            child = await createChildAsNewBlockBlob(this, context);
        } else {
            child = new BlobDirectoryTreeItem(this, path.posix.join(this.dirPath, context.childName), this.container);
        }
        AzureStorageFS.fireCreateEvent(child);
        return child;
    }

    public async copyUrl(): Promise<void> {
        const blobClient: azureStorageBlob.BlobClient = createBlobClient(this.root, this.container.name, this.dirPath);
        const url = blobClient.url;
        await vscode.env.clipboard.writeText(url);
        ext.outputChannel.show();
        ext.outputChannel.appendLog(`Blob Directory URL copied to clipboard: ${url}`);
    }

    public async deleteTreeItemImpl(context: ISuppressMessageContext): Promise<void> {
        if (!context.suppressMessage) {
            const message: string = localize('deleteBlobDir', "Are you sure you want to delete the blob directory '{0}' and all its contents?", this.label);
            await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {
            progress.report({ message: localize('deletingDirectory', 'Deleting directory "{0}"...', this.dirName) });
            let errors: boolean = await this.deleteFolder(context);

            if (errors) {
                ext.outputChannel.appendLog('Please refresh the viewlet to see the changes made.');

                const viewOutput: vscode.MessageItem = { title: 'View Errors' };
                const errorMessage: string = `Errors occurred when deleting "${this.dirName}".`;
                vscode.window.showWarningMessage(errorMessage, viewOutput).then(async (result: vscode.MessageItem | undefined) => {
                    if (result === viewOutput) {
                        ext.outputChannel.show();
                    }
                });

                throw new Error(`Errors occurred when deleting "${this.dirName}".`);
            }
        });

        AzureStorageFS.fireDeleteEvent(this);
    }

    private async deleteFolder(context: IActionContext): Promise<boolean> {
        let dirPaths: BlobDirectoryTreeItem[] = [];
        // tslint:disable-next-line: no-var-self
        let dirPath: BlobDirectoryTreeItem | undefined = this;
        let errors: boolean = false;

        // tslint:disable-next-line: strict-boolean-expressions
        while (dirPath) {
            let children: AzExtTreeItem[] = await dirPath.getCachedChildren(context);
            for (const child of children) {
                if (child instanceof BlobTreeItem) {
                    try {
                        await child.deleteTreeItemImpl(<ISuppressMessageContext>{ ...context, suppressMessage: true });
                    } catch (error) {
                        ext.outputChannel.appendLog(`Cannot delete ${child.blobPath}. ${parseError(error).message}`);
                        errors = true;
                    }
                } else if (child instanceof BlobDirectoryTreeItem) {
                    dirPaths.push(child);
                }
            }

            dirPath = dirPaths.pop();
        }

        return errors;
    }
}
