/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { platform } from 'os';
import { window } from "vscode";
import { IActionContext, UserCancelledError } from "vscode-azureextensionui";
import { ResourceType } from "../storageExplorerLauncher/ResourceType";
import { storageExplorerLauncher } from "../storageExplorerLauncher/storageExplorerLauncher";
import { localize } from "./localize";

export async function askOpenInStorageExplorer(context: IActionContext, errorMessage: string, resourceId: string, subscriptionId: string, resourceType: ResourceType, resourceName: string): Promise<void> {
    // Don't provide the option to open in Storage Explorer on Linux.
    const message: string = platform() === 'linux' ? '' : localize("openInSE", "Open resource in Storage Explorer");
    window.showErrorMessage(errorMessage, message).then(async result => {
        if (result === message) {
            context.telemetry.properties.openInStorageExplorer = 'true';
            await storageExplorerLauncher.openResource(resourceId, subscriptionId, resourceType, resourceName);
        }
    });

    // Either way, throw canceled error
    throw new UserCancelledError(message);
}
