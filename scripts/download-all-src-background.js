/**
 * @fileOverview Download All Sources background script
 * @name download-all-src-background.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

browser.runtime.onStartup.addListener(onstartup);
browser.runtime.onInstalled.addListener(oninstall);
browser.browserAction.onClicked.addListener(onclicked);

const firstrun_url = 'https://www2.filewo.net/wordpress/category/products/download-all-sources/',
      origin_url = window.document.URL,
      runcode_all_list = `{const urls = {};
for (let attr of ['src', 'href']) {
  document.querySelectorAll('['+attr+']').forEach((ele) => {
    const urlobj = new URL(ele.getAttribute(attr).replace(/#.*$/, ''), location.href);
    const url = urlobj.toString();
    if (!urls[url]) urls[url] = { url : url, protocol : urlobj.protocol, tag : [], title : [], filetype : urlobj.pathname.match(/\\.([\\w]+)$/) ? RegExp.$1 : '' };
    urls[url].tag.push(ele.tagName.toLowerCase());
    urls[url].title.push(ele.title);
  })
}
urls};`,
      runcode_selection_list = `{const urls = {};
let selection = window.getSelection();
for (let attr of ['src', 'href']) {
  for(let i=0; i<selection.rangeCount; i++) {
    selection.getRangeAt(i).cloneContents().querySelectorAll('['+attr+']').forEach((ele) => {
      const urlobj = new URL(ele.getAttribute(attr).replace(/#.*$/, ''), location.href);
      const url = urlobj.toString();
      if (!urls[url]) urls[url] = { url : url, protocol : urlobj.protocol, tag : [], title : [], filetype : urlobj.pathname.match(/\\.([\\w]+)$/) ? RegExp.$1 : '' };
      urls[url].tag.push(ele.tagName.toLowerCase());
      urls[url].title.push(ele.title);
    })
  }
}
urls};`;


function onstartup()
{
}

function oninstall(details)
{
    if (details.reason == 'install' || details.reason == 'update') {
        // installed time
        browser.storage.local.get('installed-time').then(ret => {
            if (!ret['installed-time']) config.setPref('installed-time',  parseInt((new Date()).getTime()/1000));
        });
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
        active : true, url : '/ui/manager.html'
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


// all sources
browser.menus.create({
    id : 'download-all-src-showlist',
    title : browser.i18n.getMessage('menus_download'),
    contexts : ['page', 'browser_action']
});

// link
browser.menus.create({
    id : 'download-all-src-dllink',
    title : browser.i18n.getMessage('menus_link_download'),
    contexts : ['link']
});

// selection
browser.menus.create({
    id : 'download-all-src-dlselect',
    title : browser.i18n.getMessage('menus_selection_download'),
    contexts : ['selection']
});

// all sources use selection as filename
browser.menus.create({
    id : 'download-all-src-showlist-selection-as-filename',
    title : browser.i18n.getMessage('menus_download_selection_as_filename'),
    contexts : ['selection']
});

var lastSource = {};
browser.menus.onClicked.addListener(async function(info, tab) {
    switch (info.menuItemId) {
    case 'download-all-src-showlist':
        const list_showlist = (await browser.tabs.executeScript(tab.id, {
            frameId : info.frameId,
            code : runcode_all_list
        }))[0];
        lastSource = { list : list_showlist, baseurl : tab.url };

        browser.tabs.create({
            active : true,
            url : '/ui/manager.html#source',
            openerTabId : tab.id,
            index : tab.index + 1
        });
        break;

    case 'download-all-src-dllink':
        lastSource = { link : info.linkUrl, baseurl : tab.url };
        browser.tabs.create({
            active : true,
            url : '/ui/manager.html#new',
            openerTabId : tab.id,
            index : tab.index + 1
        });
        break;

    case 'download-all-src-dlselect':
        const list_dlselect = (await browser.tabs.executeScript(tab.id, {
            frameId : info.frameId,
            code : runcode_selection_list
        }))[0];
        lastSource = { list : list_dlselect, baseurl : tab.url };

        browser.tabs.create({
            active : true,
            url : '/ui/manager.html#source',
            openerTabId : tab.id,
            index : tab.index + 1
        });
        break;

    case 'download-all-src-showlist-selection-as-filename':
        const list_showlist_selection1 = (await browser.tabs.executeScript(tab.id, {
            frameId : info.frameId,
            code : runcode_all_list
        }))[0];
        lastSource = { list : list_showlist_selection1, baseurl : tab.url, filename : info.selectionText };

        browser.tabs.create({
            active : true,
            url : 'ui/manager.html#source',
            openerTabId : tab.id,
            index : tab.index + 1
        });
        break;
    }
});

