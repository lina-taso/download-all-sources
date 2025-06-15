/**
 * @fileOverview Download All Sources Manager brace expansion module
 * @name braceexpansion.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

function braceExpansion(pattern, maxLength = 10000)
{
    // ブレースの対応をチェックし、パターンを展開するメイン関数
    function isValidBracePattern(pattern)
    {
        // ブレースの開閉が正しいか検証
        let depth = 0;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] === '{') depth++;
            if (pattern[i] === '}') depth--;
            if (depth < 0) return false;
        }
        return depth === 0;
    }

    // パターンを再帰的に展開
    function expandPattern(pattern, maxLength)
    {
        // ブレースがない場合はパターンをそのまま返す
        if (!pattern.includes('{')) return [pattern];

        let start = pattern.indexOf('{');
        let end = findClosingBrace(pattern, start);
        if (end === -1) throw new Error("Invalid brace pattern");

        let prefix = pattern.slice(0, start);
        let suffix = pattern.slice(end + 1);
        let inner = pattern.slice(start + 1, end);

        let expansions = parseInnerBrace(inner, maxLength);
        let result = [];
        for (let expansion of expansions) {
            let subPattern = prefix + expansion + suffix;
            let subExpansions = expandPattern(subPattern, maxLength);
            result.push(...subExpansions);
            if (result.length > maxLength) {
                throw new Error(`Expansion exceeds maximum length of ${maxLength}`);
            }
        }
        return result;
    }

    // 閉じブレースの位置を検索
    function findClosingBrace(pattern, start)
    {
        // 対応する閉じブレースのインデックスを返す
        let depth = 1;
        for (let i = start + 1; i < pattern.length; i++) {
            if (pattern[i] === '{') depth++;
            if (pattern[i] === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    // ブレース内の内容を解析
    function parseInnerBrace(inner, maxLength)
    {
        // カンマ区切りまたは範囲指定を処理
        if (inner.includes('..')) {
            return parseRange(inner, maxLength);
        }
        return inner.split(',').map(item => item || '');
    }

    // 範囲指定を解析
    function parseRange(inner, maxLength)
    {
        // 数値/文字範囲やステップを解析
        let parts = inner.split('..');
        if (parts.length < 2 || parts.length > 3) {
            throw new Error("Invalid range specification");
        }

        let [start, end, step = '1'] = parts;
        let stepNum = parseInt(step);

        if (stepNum === 0) {
            throw new Error("Step cannot be zero");
        }

        if (/^-?0*\d+$/.test(start) && /^-?0*\d+$/.test(end) && start.length === end.length && start.match(/^0+\d/)) {
            return expandPaddedNumericRange(start, end, stepNum, maxLength);
        }

        if (/^-?\d+$/.test(start) && /^-?\d+$/.test(end)) {
            return expandNumericRange(parseInt(start), parseInt(end), stepNum, maxLength);
        }

        if (/^[a-zA-Z]$/.test(start) && /^[a-zA-Z]$/.test(end)) {
            return expandCharRange(start, end, stepNum, maxLength);
        }

        throw new Error("Invalid range specification");
    }

    // 通常の数値範囲を展開
    function expandNumericRange(start, end, step, maxLength)
    {
        // 数値範囲をステップに従って展開
        let result = [];
        let direction = start <= end ? 1 : -1;
        let count = Math.floor(Math.abs(end - start) / step) + 1;

        if (count > maxLength) {
            throw new Error(`Range expansion exceeds maximum length of ${maxLength}`);
        }

        for (let i = start; direction > 0 ? i <= end : i >= end; i += step * direction) {
            result.push(i.toString());
        }

        return result;
    }

    // ゼロパディング付き数値範囲を展開
    function expandPaddedNumericRange(start, end, step, maxLength)
    {
        // ゼロパディングを保持して数値範囲を展開
        let result = [];
        let startNum = parseInt(start);
        let endNum = parseInt(end);
        let padding = start.length;
        let direction = startNum <= endNum ? 1 : -1;
        let count = Math.floor(Math.abs(endNum - startNum) / step) + 1;

        if (count > maxLength) {
            throw new Error(`Range expansion exceeds maximum length of ${maxLength}`);
        }

        for (let i = startNum; direction > 0 ? i <= endNum : i >= endNum; i += step * direction) {
            result.push(i.toString().padStart(padding, '0'));
        }

        return result;
    }

    // 文字範囲を展開
    function expandCharRange(start, end, step, maxLength)
    {
        // 文字範囲をステップに従って展開
        let result = [];
        let startCode = start.charCodeAt(0);
        let endCode = end.charCodeAt(0);
        let direction = startCode <= endCode ? 1 : -1;
        let count = Math.floor(Math.abs(endCode - startCode) / step) + 1;

        if (count > maxLength) {
            throw new Error(`Range expansion exceeds maximum length of ${maxLength}`);
        }

        for (let i = startCode; direction > 0 ? i <= endCode : i >= endCode; i += step * direction) {
            result.push(String.fromCharCode(i));
        }

        return result;
    }

    // メイン処理の実行
    if (!isValidBracePattern(pattern)) {
        throw new Error("Invalid brace pattern: mismatched braces");
    }
    return expandPattern(pattern, maxLength);
}

//// ブレース展開のテストを実行
//function testBraceExpansion(input, expected)
//{
//    // 単一のテストケースを実行し、結果をログに出力
//    try {
//        let result = braceExpansion(input);
//        console.log(`Input: ${input}`);
//        console.log(`Result: ${JSON.stringify(result)}`);
//        console.log(`Expected: ${JSON.stringify(expected)}`);
//        console.log(`Pass: ${JSON.stringify(result) === JSON.stringify(expected)}\n`);
//    }
//    catch (error) {
//        console.log(`Input: ${input}`);
//        console.log(`Error: ${error.message}\n`);
//    }
//}
//
//// テストケースを定義し実行
//function runTests()
//{
//    // テストケースを管理し、順に実行
//    const tests = [
//        { input: "{a,b,c}", expected: ["a", "b", "c"] },
//        { input: "{1..3}", expected: ["1", "2", "3"] },
//        { input: "{001..003}", expected: ["001", "002", "003"] },
//        { input: "{1..5..2}", expected: ["1", "3", "5"] },
//        { input: "{a..d}", expected: ["a", "b", "c", "d"] },
//        { input: "{a..z..5}", expected: ["a", "f", "k", "p", "u", "z"] },
//        { input: "{x,y}{1..2}", expected: ["x1", "x2", "y1", "y2"] },
//        { input: "{a,,c}", expected: ["a", "", "c"] },
//        { input: "{0..10..100}", expected: ["0"] },
//    ];
//
//    console.log("Running normal tests:");
//    for (let test of tests) {
//        testBraceExpansion(test.input, test.expected);
//    }
//
//    const errorTests = [
//        { input: "{a,b", expectedError: "Invalid brace pattern" },
//        { input: "{1..3..0}", expectedError: "Step cannot be zero" },
//        { input: "{z..a..0}", expectedError: "Step cannot be zero" },
//        { input: "{1..z}", expectedError: "Invalid range specification" },
//    ];
//
//    console.log("Running error tests:");
//    for (let test of errorTests) {
//        try {
//            braceExpansion(test.input);
//            console.log(`Input: ${test.input}`);
//            console.log("Error: Expected to throw but did not\n");
//        }
//        catch (error) {
//            console.log(`Input: ${test.input}`);
//            console.log(`Error: ${error.message}`);
//            console.log(`Pass: ${error.message.includes(test.expectedError)}\n`);
//        }
//    }
//}
//
//// テスト実行
//runTests();
