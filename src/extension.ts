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

class TranslationFoldingRangeProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken
	): vscode.FoldingRange[] {
		const ranges: vscode.FoldingRange[] = [];

		let groupStart: number | null = null;
		let groupPrefix: string | null = null;

		for (let i = 0; i < document.lineCount; i++) {
			const lineText = document.lineAt(i).text;
			const prefix = extractPrefix(lineText);

			if (prefix !== null && prefix === groupPrefix) {
				// 同じプレフィックスが続いている -> グループを延長
				continue;
			}

			// プレフィックスが変わった（または null になった）-> 前のグループを確定
			if (groupStart !== null && groupPrefix !== null) {
				const groupEnd = i - 1;
				if (groupEnd > groupStart) {
					ranges.push(new vscode.FoldingRange(groupStart, groupEnd));
				}
			}

			// 新しいグループを開始（ドット付きキーの場合のみ）
			if (prefix !== null) {
				groupStart = i;
				groupPrefix = prefix;
			} else {
				groupStart = null;
				groupPrefix = null;
			}
		}

		// ファイル末尾で未確定のグループを確定
		if (groupStart !== null && groupPrefix !== null) {
			const groupEnd = document.lineCount - 1;
			if (groupEnd > groupStart) {
				ranges.push(new vscode.FoldingRange(groupStart, groupEnd));
			}
		}

		return ranges;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new TranslationFoldingRangeProvider();
	const disposable = vscode.languages.registerFoldingRangeProvider(
		{ language: 'json' },
		provider
	);
	context.subscriptions.push(disposable);
}

export function deactivate() {}
