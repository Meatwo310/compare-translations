import * as vscode from 'vscode';

/**
 * JSONの行からドット区切りキーの最初のセグメント（プレフィックス）を取得する。
 * 例: `"advancements.foo.bar": "baz"` -> `"advancements"`
 * キーにドットが含まれない行や、JSONキーでない行は null を返す。
 */
function extractPrefix(line: string): string | null {
	const match = line.match(/^\s*"([^"]+)"\s*:/);
	if (!match) {
		return null;
	}
	const key = match[1];
	const dotIndex = key.indexOf('.');
	if (dotIndex === -1) {
		return null;
	}
	return key.substring(0, dotIndex);
}

/** グループの情報（先頭行・件数） */
interface Group {
	prefix: string;
	startLine: number;
	count: number;
}

/**
 * ドキュメント全体を走査し、同一プレフィックスが連続する行をグループとして返す。
 * 件数が1のグループ（折りたたみ不要）も含む。
 */
function collectGroups(document: vscode.TextDocument): Group[] {
	const groups: Group[] = [];

	let groupStart: number | null = null;
	let groupPrefix: string | null = null;
	let groupCount = 0;

	const pushGroup = (endLine: number) => {
		if (groupStart !== null && groupPrefix !== null && groupCount >= 1) {
			groups.push({ prefix: groupPrefix, startLine: groupStart, count: groupCount });
		}
	};

	for (let i = 0; i < document.lineCount; i++) {
		const lineText = document.lineAt(i).text;
		const prefix = extractPrefix(lineText);

		if (prefix !== null && prefix === groupPrefix) {
			groupCount++;
			continue;
		}

		// プレフィックスが変わった -> 前のグループを確定
		pushGroup(i - 1);

		if (prefix !== null) {
			groupStart = i;
			groupPrefix = prefix;
			groupCount = 1;
		} else {
			groupStart = null;
			groupPrefix = null;
			groupCount = 0;
		}
	}

	// ファイル末尾で未確定のグループを確定
	pushGroup(document.lineCount - 1);

	return groups;
}

class TranslationFoldingRangeProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken
	): vscode.FoldingRange[] {
		const groups = collectGroups(document);
		return groups
			.filter(g => g.count > 1)
			.map(g => new vscode.FoldingRange(g.startLine, g.startLine + g.count - 1));
	}
}

/**
 * グループのデコレーションを管理するクラス。
 * グループ先頭行の before に `<prefix> [N entries]` を表示する。
 * contentText 末尾の "\n" で後続行との間に改行を挿入する。
 */
class GroupDecorationManager {
	private readonly decorationType: vscode.TextEditorDecorationType;

	constructor() {
		// スタイルは個別デコレーションの renderOptions で指定するため、
		// ここでは before を定義せずシンプルに生成する
		this.decorationType = vscode.window.createTextEditorDecorationType({});
	}

	updateDecorations(editor: vscode.TextEditor): void {
		if (editor.document.languageId !== 'json') {
			editor.setDecorations(this.decorationType, []);
			return;
		}

		const groups = collectGroups(editor.document);
		const decorations: vscode.DecorationOptions[] = groups.map(g => {
			const line = editor.document.lineAt(g.startLine);
			// 行頭の範囲（0文字）に before デコレーションを付与する
			const range = new vscode.Range(line.range.start, line.range.start);
			const entriesLabel = g.count === 1 ? '1 entry' : `${g.count} entries`;
			return {
				range,
				renderOptions: {
					before: {
						contentText: `${g.prefix} [${entriesLabel}]\n`,
						color: new vscode.ThemeColor('editorLineNumber.foreground'),
						fontStyle: 'italic',
					},
				},
			};
		});

		editor.setDecorations(this.decorationType, decorations);
	}

	dispose(): void {
		this.decorationType.dispose();
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Folding
	const foldingProvider = new TranslationFoldingRangeProvider();
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({ language: 'json' }, foldingProvider)
	);

	// Decorations
	const decorationManager = new GroupDecorationManager();
	context.subscriptions.push({ dispose: () => decorationManager.dispose() });

	// アクティブエディタが切り替わったときに更新
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				decorationManager.updateDecorations(editor);
			}
		})
	);

	// ドキュメントが編集されたときに更新
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document === event.document) {
				decorationManager.updateDecorations(editor);
			}
		})
	);

	// 起動時点でアクティブなエディタにも適用
	if (vscode.window.activeTextEditor) {
		decorationManager.updateDecorations(vscode.window.activeTextEditor);
	}
}

export function deactivate() {}
