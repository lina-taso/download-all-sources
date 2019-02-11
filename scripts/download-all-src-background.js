/**
 * @fileOverview Download All Sources background script
 * @name download-all-src-background.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

browser.runtime.onStartup.addListener(startup);
browser.runtime.onInstalled.addListener(install);
browser.browserAction.onClicked.addListener(onclicked);

const firstrun_url = 'https://www2.filewo.net/wordpress/category/products/download-all-sources/',
      origin_url = window.document.URL,
      runCode = `{let urls = {};
for(let attr of ['src', 'href']) {
  document.querySelectorAll('['+attr+']').forEach((ele) => {
    let urlobj = new URL(ele.getAttribute(attr).replace(/#.*$/, ''), location.href);
    let url = urlobj.toString();
    if (!urls[url]) urls[url] = { url : url, protocol : urlobj.protocol, tag : [], title : [], filetype : urlobj.pathname.match(/\\.([\\w]+)$/) ? RegExp.$1 : '' };
    urls[url].tag.push(ele.tagName.toLowerCase());
    urls[url].title.push(ele.title);
  })
}
urls};`;


function startup()
{
}

function install(details)
{
    if (details.reason == 'install'
        || details.reason == 'update') {

        return browser.tabs.create({
            url : firstrun_url,
            active : true
        });
    }
    return Promise.resolve();
}

function onclicked()
{
    browser.tabs.create({
        active : true, url : 'ui/manager.html'
    });
}

// request hook
browser.webRequest.onBeforeSendHeaders.addListener(function(details) {
    // hook only requests by this addon
    if (details.originUrl != origin_url) return null;

    var blockingResponse = { requestHeaders : [] };

    // modify headers
    for (let header of details.requestHeaders) {
        if (/^X-DAS-/.test(header.name))
            blockingResponse.requestHeaders.push({
                name : header.name.replace(/^X-DAS-/, ''),
                value : header.value
            });
        else
            blockingResponse.requestHeaders.push(header);
    }
    return blockingResponse;
}, { urls : ["<all_urls>"] }, ["blocking", "requestHeaders"]);

browser.webRequest.onSendHeaders.addListener(function(details) {
    if (details.originUrl != origin_url) return;
}, { urls : ["<all_urls>"] }, ["requestHeaders"]);


browser.contextMenus.create({
    id : 'download-all-src-showlist',
    title : browser.i18n.getMessage('menus_download')
});

var lastSource = {};
browser.contextMenus.onClicked.addListener(async function(info, tab) {
    switch (info.menuItemId) {
    case 'download-all-src-showlist':
        let list = (await browser.tabs.executeScript(tab.id, {
            frameId : info.frameId,
            code : runCode
        }))[0];
        lastSource = { list : list, baseurl : '' };

        // base url
        lastSource.baseurl = tab.url;
        browser.tabs.create({
            active : true,
            url : 'ui/manager.html#source',
            openerTabId : tab.id,
            index : tab.index + 1
        });
        break;
    }
});

