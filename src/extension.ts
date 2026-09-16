import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const openReadme = vscode.commands.registerCommand('spottercode.openReadme', async () => {
    const readmePath = vscode.Uri.joinPath(context.extensionUri, 'README.md');
    await vscode.commands.executeCommand('markdown.showPreview', readmePath);
  });

  context.subscriptions.push(openReadme);

  vscode.window.setStatusBarMessage('SpotterCode ready', 2000);
}

export function deactivate(): void {
  // no-op
}
