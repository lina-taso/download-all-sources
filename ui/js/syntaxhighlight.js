/**
 * @fileOverview Download All Sources Manager highlighted-code module loader script
 * @name syntaxhighlight.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

(async () => {
    const {default: HighlightedCode} = await import('./web.js');
    // bootstrap a theme through one of these names
    // https://github.com/highlightjs/highlight.js/tree/main/src/styles
    HighlightedCode.useTheme(browser.runtime.getURL('/ui/css/atom-one-dark.css'));
})(self);
