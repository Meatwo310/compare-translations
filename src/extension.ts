import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LOCALE_FILE_PATTERN = /^[a-z]{2}_[a-z]{2}\.json$/i;

const decorationType = vscode.window.createTextEditorDecorationType({
	after: {
		color: new vscode.ThemeColor('editorCodeLens.foreground'),
		fontStyle: 'italic',
		margin: '0 0 0 1em',
	},
});

let originalFilePath: string | undefined;

function updateDecorations(editor: vscode.TextEditor): void {
	const fileName = path.basename(editor.document.fileName);

	if (!LOCALE_FILE_PATTERN.test(fileName) || !originalFilePath) {
		editor.setDecorations(decorationType, []);
		return;
	}

	if (editor.document.fileName === originalFilePath) {
		editor.setDecorations(decorationType, []);
		return;
	}

	if (!fs.existsSync(originalFilePath)) {
		editor.setDecorations(decorationType, []);
		return;
	}

	let originalData: Record<string, unknown>;
	try {
		originalData = JSON.parse(fs.readFileSync(originalFilePath, 'utf8'));
	} catch {
		editor.setDecorations(decorationType, []);
		return;
	}

	const decorations: vscode.DecorationOptions[] = [];

	for (let i = 0; i < editor.document.lineCount; i++) {
		const line = editor.document.lineAt(i);
		// キー行を検出: "key": ...
		const match = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(line.text);
		if (!match) {
			continue;
		}

		const key = JSON.parse(`"${match[1]}"`);
		const originalValue = originalData[key];

		if (typeof originalValue === 'string') {
			decorations.push({
				range: line.range,
				renderOptions: {
					after: { contentText: originalValue },
				},
			});
		}
	}

	editor.setDecorations(decorationType, decorations);
}

export function activate(context: vscode.ExtensionContext) {
	originalFilePath = context.workspaceState.get<string>('originalTranslationFile');

	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('compare-translations.setAsOriginal', (uri: vscode.Uri) => {
			originalFilePath = uri.fsPath;
			context.workspaceState.update('originalTranslationFile', originalFilePath);

			const editor = vscode.window.activeTextEditor;
			if (editor) {
				updateDecorations(editor);
			}

			vscode.window.showInformationMessage(
				vscode.l10n.t('Set as translation reference: {0}', path.basename(originalFilePath))
			);
		}),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateDecorations(editor);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (editor && event.document === editor.document) {
				updateDecorations(editor);
			}
		}),
		vscode.workspace.onDidSaveTextDocument(() => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				updateDecorations(editor);
			}
		}),
	);
}

export function deactivate() {
	decorationType.dispose();
}
