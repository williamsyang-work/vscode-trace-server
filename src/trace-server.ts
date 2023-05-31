import { ChildProcess, spawn } from 'child_process';
import { TspClient } from 'tsp-typescript-client/lib/protocol/tsp-client';
import treeKill from 'tree-kill';
import * as vscode from 'vscode';

// Based on github.com/eclipse-cdt-cloud/vscode-trace-extension/blob/master/vscode-trace-extension/package.json
// -for naming consistency purposes across sibling extensions/settings:
const section = 'trace-server.traceserver';

const exit = 'exit';
const key = 'pid';
const millis = 10000;
const none = -1;
const prefix = 'Trace Server';
const suffix = ' failure or so.';

export class TraceServer {
    private server: ChildProcess | undefined;

    private start(context: vscode.ExtensionContext | undefined) {
        const from = vscode.workspace.getConfiguration(section);
        const server = spawn(this.getPath(from), this.getArgs(from));

        if (!server.pid) {
            this.showError(prefix + ' startup' + suffix);
            return;
        }
        this.server = server;
        context?.workspaceState.update(key, this.server.pid);
        const serverUrl = this.getUrl(from) + '/' + this.getApiPath(from);
        this.waitFor(serverUrl, context);
    }

    stopOrReset(context: vscode.ExtensionContext | undefined) {
        const pid: number | undefined = context?.workspaceState.get(key);
        if (pid === none) {
            return;
        }
        if (pid) {
            let id: NodeJS.Timeout;
            // recovering from workspaceState => no this.server set
            if (this.server) {
                this.server.once(exit, () => {
                    this.showStatus(false);
                    clearTimeout(id);
                });
            }
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: prefix,
                    cancellable: false
                },
                async progress => {
                    progress.report({ message: 'Stopping...' });
                    const message = prefix + ' stopping' + suffix;
                    treeKill(pid, error => {
                        if (error) {
                            this.showError(message);
                        } else {
                            id = setTimeout(() => this.showError(message), millis);
                        }
                    });
                }
            );
        }
        context?.workspaceState.update(key, none);
        this.server = undefined;
    }

    startIfStopped(context: vscode.ExtensionContext | undefined) {
        const pid = context?.workspaceState.get(key);
        const stopped = !pid || pid === none;
        if (stopped) {
            this.start(context);
        }
    }

    private getPath(configuration: vscode.WorkspaceConfiguration): string {
        let path = configuration.get<string>('path');
        if (!path) {
            // Based on this extension's package.json default, if unset here:
            path = '/usr/bin/tracecompass-server';
        }
        return path;
    }
    getPath_test = this.getPath;

    private getArgs(configuration: vscode.WorkspaceConfiguration): string[] {
        let args = configuration.get<string>('arguments');
        if (!args) {
            args = '';
        }
        return args.split(' ');
    }
    getArgs_test = this.getArgs;

    private getUrl(configuration: vscode.WorkspaceConfiguration): string {
        let url = configuration.get<string>('url');
        if (!url) {
            url = 'http://localhost:8080';
        }
        return url;
    }
    getUrl_test = this.getUrl;

    private getApiPath(configuration: vscode.WorkspaceConfiguration): string {
        let apiPath = configuration.get<string>('apiPath');
        if (!apiPath) {
            apiPath = 'tsp/api';
        }
        return apiPath;
    }
    getApiPath_test = this.getApiPath;

    private async waitFor(serverUrl: string, context: vscode.ExtensionContext | undefined) {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: prefix,
                cancellable: false
            },
            async progress => {
                progress.report({ message: 'Starting up...' });
                const client = new TspClient(serverUrl);
                let timeout = false;
                const timeoutId = setTimeout(() => (timeout = true), millis);

                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const health = await client.checkHealth();
                    const status = health.getModel()?.status;

                    if (health.isOk() && status === 'UP') {
                        this.showStatus(true);
                        this.server?.once(exit, () => {
                            this.stopOrReset(context);
                        });
                        clearTimeout(timeoutId);
                        break;
                    }
                    if (timeout) {
                        this.showError(prefix + ' startup timed-out after ' + millis + 'ms.');
                        this.stopOrReset(context);
                        break;
                    }
                }
            }
        );
    }

    private showError(message: string) {
        console.error(message);
        vscode.window.showErrorMessage(message);
    }

    private showStatus(started: boolean) {
        if (started) {
            vscode.window.showInformationMessage(prefix + ': Started.');
        } else {
            vscode.window.showInformationMessage(prefix + ': Stopped.');
        }
        this.setStatusIfAvailable(started);
    }

    private setStatusIfAvailable(started: boolean) {
        const fromTraceExtension = 'serverStatus';
        if (started) {
            vscode.commands.executeCommand(fromTraceExtension + '.started');
        } else {
            vscode.commands.executeCommand(fromTraceExtension + '.stopped');
        }
    }
}
