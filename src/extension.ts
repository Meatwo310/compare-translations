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

const FOLD_GROUP_COMMAND = 'translation-tree.foldGroup';

/**
 * Code Lens プロバイダ。
 * 各グループの startLine に、同じ行を起点とする全グループを深さ順に並べた
 * Code Lens を登録する。クリックすると対象グループの範囲を折りたたむ。
 *
 * 同一 startLine に複数グループが存在する場合（親子の重複）は、
 * プレフィックスのドット数（= 深さ）昇順でそれぞれ独立した CodeLens として返す。
 */
class TranslationCodeLensProvider implements vscode.CodeLensProvider {
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.languageId !== 'json') {
			return [];
		}

		const groups = collectGroups(document).filter(g => g.count > 1);

		// startLine でグループ化し、深さ（ドット数）昇順にソート
		const byLine = new Map<number, Group[]>();
		for (const g of groups) {
			const list = byLine.get(g.startLine) ?? [];
			list.push(g);
			byLine.set(g.startLine, list);
		}

		const lenses: vscode.CodeLens[] = [];
		for (const [startLine, lineGroups] of byLine) {
			lineGroups.sort((a, b) =>
				a.prefix.split('.').length - b.prefix.split('.').length
			);

			const range = new vscode.Range(startLine, 0, startLine, 0);
			for (const g of lineGroups) {
				lenses.push(new vscode.CodeLens(range, {
					title: `▾ ${g.prefix} [${g.count}]`,
					command: FOLD_GROUP_COMMAND,
					arguments: [g.startLine, g.startLine + g.count - 1],
				}));
			}
		}

		return lenses;
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Folding
	const foldingProvider = new TranslationFoldingRangeProvider();
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({ language: 'json' }, foldingProvider)
	);

	// Code Lens
	const codeLensProvider = new TranslationCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ language: 'json' }, codeLensProvider)
	);

	// ドキュメントが編集されたときに Code Lens を更新
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(() => codeLensProvider.refresh())
	);

	// foldGroup コマンド: startLine を含む折りたたみ範囲を折りたたむ。
	// editor.fold は selectionLines のカーソル行を起点に FoldingRangeProvider の
	// 範囲を選んで折りたたむため、まずカーソルを startLine へ移動してから実行する。
	context.subscriptions.push(
		vscode.commands.registerCommand(
			FOLD_GROUP_COMMAND,
			(startLine: number, _endLine: number) => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}
				const pos = new vscode.Position(startLine, 0);
				editor.selection = new vscode.Selection(pos, pos);
				vscode.commands.executeCommand('editor.fold', {
					selectionLines: [startLine],
				});
			}
		)
	);
}

export function deactivate() {}
