import { EditorView, keymap, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { ChangeSet, ChangeSpec, EditorSelection, EditorState, StateField, Transaction } from "@codemirror/state";

type PatternType = 'arabic' | 'uppercaseLetter' | 'lowercaseLetter' | 'romanNumeral' | 'chineseNumeral';

/**
 * 识别给定文本行的列表模式。
 * @param lineText 要识别的文本行。
 * @returns 返回识别出的列表模式类型，如果没有匹配，则返回 null。
 */
function identifyPattern(lineText: string): PatternType | null {
    const patterns: { [key in PatternType]: RegExp } = {
        arabic: /^\d+[\.|、]/,
        uppercaseLetter: /^[A-Z][\.|、]/,
        lowercaseLetter: /^[a-z][\.|、]/,
        romanNumeral: /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})[\.|、]/,
        chineseNumeral: /^[\u4e00-\u9fa5]+[\.|、]/
    };

    for (let type in patterns) {
        if (patterns[type as PatternType].test(lineText)) {
            return type as PatternType;
        }
    }
    return null;
}

/**
 * 根据当前编号和模式类型获取下一个编号。
 * @param currentNumber 当前编号。
 * @param patternType 列表模式类型。
 * @returns 返回计算后的下一个编号，如果无法处理则返回 null。
 */
function getNextNumber(currentNumber: string, punctuation: string, patternType: PatternType): string | null {
    switch (patternType) {
        case "arabic":
            return parseInt(currentNumber) + 1 + punctuation;
        case "uppercaseLetter":
            return String.fromCharCode(currentNumber.charCodeAt(0) + 1) + punctuation;
        case "lowercaseLetter":
            return String.fromCharCode(currentNumber.charCodeAt(0) + 1) + punctuation;
        case "romanNumeral":
            let arabicNum = romanToArabic(currentNumber);
            return arabicToRoman(arabicNum + 1) + punctuation;
        case "chineseNumeral":
            let arabicNumChinese = chineseToArabic(currentNumber);
            return arabicToChinese(arabicNumChinese + 1) + punctuation;
        default:
            return null;
    }
}

// 罗马数字转阿拉伯数字
function romanToArabic(roman: string): number {
    const romanNumerals: { [key: string]: number } = {
        M: 1000, CM: 900, D: 500, CD: 400, C: 100,
        XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5,
        IV: 4, I: 1
    };
    let arabic = 0;
    let i = roman.length;
    while (i--) {
        if (romanNumerals[roman[i]] < romanNumerals[roman[i + 1]]) {
            arabic -= romanNumerals[roman[i]];
        } else {
            arabic += romanNumerals[roman[i]];
        }
    }
    return arabic;
}

/**
 * 将阿拉伯数字转换为罗马数字。
 * @param number 要转换的阿拉伯数字。
 * @returns 转换后的罗马数字字符串。
 */
function arabicToRoman(number: number): string {
    const romanNumerals = {M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1};
    let roman = '';
    for (let key in romanNumerals) {
        // @ts-ignore
        while (number >= romanNumerals[key]) {
            roman += key;
            // @ts-ignore
            number -= romanNumerals[key];
        }
    }
    return roman;
}

/**
 * 将单个中文数字字符转换为相应的阿拉伯数字。
 * @param chinese 要转换的单个中文数字字符。
 * @returns 转换后的阿拉伯数字，如果无法识别则返回 0。
 */
function chineseToArabic(chinese: string): number {
    const chineseNumerals: { [key: string]: number } = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
    };
    return chineseNumerals[chinese] || 0;
}

/**
 * 将阿拉伯数字转换为中文数字字符。
 * @param number 要转换的阿拉伯数字。
 * @returns 转换后的中文数字字符，如果无法识别则返回空字符串。
 */
function arabicToChinese(number: number): string {
    const chineseNumerals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    return chineseNumerals[number] || '';
}

function calculateNewCursorPosition(forEnterChanges: ChangeSpec[], state: EditorState): number {
    // 取最后一个更改的结束位置作为新的光标位置
    let lastChangeEnd = 0;
    if(forEnterChanges.length === 0) return lastChangeEnd;
    if(forEnterChanges.length === 1) {
        if('insert' in forEnterChanges[0] && (forEnterChanges[0].insert as string)?.trim() === '') {
            return (forEnterChanges[0] as any).from  || 0;
        }
    }


    forEnterChanges.forEach(change => {
        if ('from' in change && 'to' in change) {
            lastChangeEnd = (change?.to || 0) + (change?.insert?.length as number) || 0;
        }
    });

    return lastChangeEnd;
}


/**
 * 从行文本中提取括号和无括号的文本部分。
 * @param lineText 行文本。
 * @returns 返回括号和无括号的文本部分。
 */
function extractBracketsAndText(lineText: string): [string, string, string] {
    const reg = /^([\(\[\【\（])?([^\）\]\】\)]*)([\）\]\】\)])?([\.、](.*))/;
    const match = new RegExp(reg, 'gm').exec(lineText);

    if (match) {
        return [match[1] || '', (match[2] || '') + (match[4] || ''), (match[3] || '') ];
    } else {
        return ['', lineText, ''];
    }
}

/**
 * 处理删除操作，特别是涉及到序号的删除。
 * @param transaction 当前事务。
 * @param state 编辑器状态。
 * @returns 更新后的状态。
 */
function handleDelete(transaction: Transaction, state: EditorState) {
    const changes: ChangeSpec[] = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const deletedText = transaction.startState.doc.sliceString(fromA, toA);
        const currentLineText = state.doc.lineAt(fromA).text;
        const nextLine = state.doc.lineAt(toB + 1);

        if (deletedText.includes('\n') || currentLineText.trim() === '') {
            // 检测下一行是否有序号
            const [_, textWithoutBracketsNext, __] = extractBracketsAndText(nextLine.text);

            const patternTypeNextLine = identifyPattern(textWithoutBracketsNext);


            if (patternTypeNextLine) {
                // 检测删除行的上一行是否有序号，并去除括号
                const prevLine = state.doc.lineAt(fromA - 1);
                const [bracketLeftPrev, textWithoutBracketsPrev, bracketRightPrev] = extractBracketsAndText(prevLine.text);
                const patternTypePrevLine = identifyPattern(textWithoutBracketsPrev || '');

                let lineNumber = nextLine.number;
                let currentNumber = patternTypePrevLine && deletedText.includes('\n') ? extractNumber(textWithoutBracketsPrev, patternTypePrevLine) : 0;

                while (lineNumber <= state.doc.lines) {
                    const line = state.doc.line(lineNumber);
                    const [bracketLeft, textWithoutBrackets, bracketRight] = extractBracketsAndText(line.text);
                    const linePatternType = identifyPattern(textWithoutBrackets);

                    if(linePatternType === null) break;

                    if (linePatternType) {
                        const targetNumberText = currentNumber.toString();
                        const currentNumberText = extractNumber(textWithoutBrackets, linePatternType).toString();
                        console.log(textWithoutBrackets, currentNumberText, currentNumber);
                        const newNumberText = getNextNumber(targetNumberText, '', linePatternType);
                        if (newNumberText) {
                            const updatedText = `${bracketLeft}${newNumberText}${bracketRight}${textWithoutBrackets.slice(currentNumberText.length)}`;
                            changes.push({from: line.from, to: line.to, insert: updatedText});
                        }
                        currentNumber++;
                    }
                    lineNumber++;
                }
            }
        }
    });

    return changes;
}

/**
 * 从行文本中提取序号。
 * @param lineText 行文本。
 * @param patternType 模式类型。
 * @returns 提取的序号。
 */
function extractNumber(lineText: string, patternType: PatternType): number {
    const match = lineText.match(/^[\w\u4e00-\u9fa5]+/);
    if (match) {
        switch (patternType) {
            case "arabic":
                return parseInt(match[0]);
            case "uppercaseLetter":
            case "lowercaseLetter":
                return match[0].charCodeAt(0);
            case "romanNumeral":
                return romanToArabic(match[0]);
            case "chineseNumeral":
                return chineseToArabic(match[0]);
            default:
                return 1;
        }
    }
    return 1;
}

/**
 * 检测并处理回车字符。
 * @param transaction 当前事务。
 * @param state 编辑器状态。
 * @returns 更新后的状态。
 */
function checkForEnter(transaction: Transaction, state: EditorState) {
    const changes: ChangeSpec[] = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        let text = inserted.toString();
        if (text.includes('\n')) { // 检测到回车
            const currentLineStart = state.doc.lineAt(fromA).from;
            const currentLineEnd = state.doc.lineAt(fromA).to;
            const behindLineStart = state.doc.lineAt(toB).from;
            const behindLineEnd = state.doc.lineAt(toB).to;

            const behindLineText = state.doc.sliceString(behindLineStart, behindLineEnd);
            const currentLineText = state.doc.sliceString(currentLineStart, currentLineEnd);

            if(currentLineText.trim() === '') return; // 如果当前行为空行，不进行处理
            const reg = /^([\(\[\【\（])?([^\）\]\】\)]*)([\）\]\】\)])?([\.、](.*))/;


            if(new RegExp(reg, 'gm').exec(currentLineText)?.[5]?.trim() === '' && behindLineText.trim() === '') {
                // 因为现在是第二次回车，但是除了标号以外的内容为空，所以需要删除这一行
                const removePosStart = state.doc.lineAt(fromA).from; // 新行的开始位置
                const removePosEnd = state.doc.lineAt(fromA).to + 1; // 新行的结束位置
                const tChanges = { from: removePosStart, to: removePosEnd, insert: '' };

                changes.push(tChanges);
                return;
            }

            // 检测行首的成对括号
            let bracketPattern = new RegExp(reg, 'gm'); // 检测成对括号
            const bracketMatch = bracketPattern.exec(currentLineText);
            const hasBrackets = bracketMatch !== null && bracketMatch[3] != undefined;
            const textWithoutBrackets = hasBrackets ? currentLineText.replace(bracketPattern, '$2$4') : currentLineText;

            let pattern = identifyPattern(textWithoutBrackets);
            if(pattern === 'arabic' && !hasBrackets) return;
            if (pattern) {
                const currentNumber = textWithoutBrackets.match(/^[\w\u4e00-\u9fa5]+/)?.[0]; // 提取序号部分
                const punctuation = textWithoutBrackets.match(/^[\w\u4e00-\u9fa5]+[\.\、]/)?.[0].slice(-1) || '.';
                if (!currentNumber) return; // 如果没有序号，不进行处理
                let nextNumber = getNextNumber(currentNumber, punctuation, pattern);

                if (nextNumber !== null) {
                    // 如果存在成对括号，还原它们
                    nextNumber = hasBrackets && bracketMatch[1] !== undefined ? ((bracketMatch[1] + nextNumber.slice(0, -1) + bracketMatch[3]) + nextNumber.slice(-1)) : nextNumber;

                    const insertPosition = state.doc.lineAt(toB).from; // 新行的开始位置
                    const tChanges = { from: insertPosition, to: insertPosition, insert: nextNumber + (punctuation === "、" ? "" : " ") };

                    changes.push(tChanges);
                }
            }
        }
    });
    return changes;
}

export const enterPressPlugin = () => {
    return ViewPlugin.fromClass(
        class {
            update(update: ViewUpdate) {
                if (!update.docChanged) return;
                if (
                    update.transactions.some(
                        (tr) =>
                            tr.annotation(Transaction.userEvent) === "undo" ||
                            tr.annotation(Transaction.userEvent) === "redo" ||
                            tr.annotation(Transaction.userEvent) === "plugin-update" ||
                            tr.annotation(Transaction.userEvent) === "set",
                    )
                )
                    return;


                if (update.docChanged) {
                    if(update.transactions.some(tr => tr.annotation(Transaction.userEvent)?.contains("delete"))) {
                        console.log('delete', update.transactions);

                        update.transactions.forEach((tr) => {
                            if (tr.docChanged) {
                                const forDeleteChanges: ChangeSpec[] = handleDelete(update.transactions[0], update.view.state);
                                if(forDeleteChanges.length === 0) return;

                                setTimeout(()=>{
                                    const tr = update.view.state.update({
                                        changes: ChangeSet.of(forDeleteChanges, update.view.state.doc.length),
                                    });
                                    update.view.dispatch(tr);
                                });
                            }
                        })

                        return;
                    }

                    update.transactions.forEach((tr) => {
                        if (tr.docChanged) {
                            const forEnterChanges: ChangeSpec[] = checkForEnter(tr, update.view.state);
                            if(forEnterChanges.length === 0) return;

                            if (forEnterChanges.length > 0) {
                                setTimeout(() => {
                                    const newCursorPosition = calculateNewCursorPosition(forEnterChanges, update.view.state);

                                    const tr = update.view.state.update({
                                        changes: ChangeSet.of(forEnterChanges, update.view.state.doc.length),
                                        selection: EditorSelection.cursor(newCursorPosition)
                                    });
                                    update.view.dispatch(tr);
                                });
                            }
                        }
                    });
                }
            }
        }
    );
};
