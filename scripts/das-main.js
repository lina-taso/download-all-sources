/**
 * @fileOverview Download All Sources main script
 * @name das-main.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

browser.downloads.onChanged.addListener(fxDownloadChanged);
browser.storage.onChanged.addListener(configChanged);

const defaultFilename = 'download';

var lastid = 0,
    downloadQueue = [],
    fxDownloadQueue = [],
    simultaneousCounts = { whole : null,
                           'per-server' : null };

var config = {
    getPref : async function(key)
    {
        var  config = Object.assign({}, defaultconfig);
        config = Object.assign(config, await browser.storage.local.get());
        return key == null ? config : config[key];
    },
    setPref : function(key, val)
    {
        if (!key) return Promise.reject();

        var setting;
        if (val == null)
            setting = browser.storage.local.remove(key);
        else {
            let obj = {};
            obj[key] = val;
            setting = browser.storage.local.set(obj);
        }
        return setting;
    }
};
Object.freeze(config);

(async () => {
    // simultaneous download count
    simultaneousCounts['whole'] = await config.getPref('simultaneous-whole');
    simultaneousCounts['per-server'] = await config.getPref('simultaneous-per-server');
})();


// download file
async function downloadFile(url, requestHeaders, location, filename)
{
    var dlid = lastid++;

    // xhr
    var xhr = new XMLHttpRequest();

    // xhr events
    xhr.addEventListener('load', function(e) {
        if (this.status == 200) {
            // update progress
            downloadQueue[dlid].loaded = e.loaded;
            downloadQueue[dlid].total = e.total;
            downloadQueue[dlid].estimate = 0;

            // update download queue
            downloadCompleted(this.response, dlid);
        }
        else downloadFailed();
    });
    xhr.addEventListener('abort', function() { downloadCancelled(dlid); });
    xhr.addEventListener('timeout', function() { downloadTimeout(dlid); });
    xhr.addEventListener('error', function() { downloadFailed(dlid); });
    xhr.addEventListener('progress', function(e) {
        downloadQueue[dlid].loaded = e.loaded;
        downloadQueue[dlid].total = e.total;
    });
    function onreadystatechange(e) {
        // update download queue (url & filename)
        if (this.readyState == 2) {
            let url = new URL(this.responseURL);
            downloadQueue[dlid].responseUrl = this.responseURL;
            downloadQueue[dlid].responseFilename = url.pathname.match("/([^/]*)$")[1];
            xhr.removeEventListener('readystatechange', onreadystatechange);
        }
    }
    xhr.addEventListener('readystatechange', onreadystatechange);

    // xhr parameter
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    for (let header of requestHeaders)
         xhr.setRequestHeader(header.name, header.value);

    var status = 'downloading';
    var domain = (new URL(url)).hostname;
    if (searchQueue({ status : 'downloading' }).length >= simultaneousCounts['whole']) status = 'waiting';
    else if (searchQueue({ status : 'downloading', originalDomain : domain }).length >= simultaneousCounts['per-server']) status = 'waiting';

    // queuing
    downloadQueue[dlid] = {
        id : dlid,
        regTime : (new Date()).getTime(),
        startTime : null,
        endTime : null,
        status : status,
        reason : '',
        xhr : xhr,
        originalUrl : url,
        originalDomain : domain,
        location : location, // if location is specified, last character must be '/'|'\\'
        filename : filename,
        responseUrl : '',
        responseFilename : '',
        requestHeaders : JSON.parse(JSON.stringify(requestHeaders)),
        loaded : 0,
        total : 0 // if 0, download is not started or total size is unknown
    };

    // run
    if (status == 'downloading') {
        xhr.send();
        downloadQueue[dlid].startTime = (new Date()).getTime();
    }

    // update badge
    updateBadge();
}

function stopDownload(dlid)
{
    const queue = downloadQueue[dlid];
    if (queue.status == 'downloading') queue.xhr.abort();
    else downloadCancelled(dlid);
}

function deleteQueue(dlid)
{
    downloadQueue[dlid] = { status : 'deleted' };
}

function searchQueue(query)
{
    var result = Array.from(downloadQueue);

    for (let key of Object.keys(query))
        result = result.filter(ele => ele[key] == query[key]);
    return result;
}

async function downloadCompleted(blob, dlid)
{
    // filename
    var filename;
    // specified filename
    if (downloadQueue[dlid].filename)
        filename = downloadQueue[dlid].location + downloadQueue[dlid].filename;
    // url's leafname
    else if (downloadQueue[dlid].responseFilename)
        filename = downloadQueue[dlid].location + downloadQueue[dlid].responseFilename;
    // noname
    else {
        if (blob.type == 'text/html')
            filename = downloadQueue[dlid].location + defaultFilename + '.html';
        else
            filename = downloadQueue[dlid].location + defaultFilename;
    }

    // wait
    await new Promise((resolve, reject) => { setTimeout(resolve, Math.floor(Math.random() * 1000)); });

    // download created object
    var objurl = URL.createObjectURL(blob);
    var itemid = await browser.downloads.download({
        url : objurl,
        saveAs : false,
        filename : filename
    });

    // update queue
    downloadQueue[dlid].status = 'downloaded';

    fxDownloadQueue[itemid] = {
        objurl : objurl,
        blob : blob,
        dlid : dlid,
        filename : filename,
        retry : false
    };
}

function downloadCancelled(dlid)
{
    downloadQueue[dlid].status = 'finished';
    downloadQueue[dlid].reason = 'cancelled';
    downloadQueue[dlid].xhr = undefined;
    downloadQueue[dlid].endTime = (new Date()).getTime();

    // waiting queue
    checkWaiting();
}

function downloadTimeout(dlid)
{
    downloadQueue[dlid].status = 'finished';
    downloadQueue[dlid].reason = 'timeout';
    downloadQueue[dlid].xhr = undefined;
    downloadQueue[dlid].endTime = (new Date()).getTime();

    // waiting queue
    checkWaiting();
}

function downloadFailed(dlid)
{
    downloadQueue[dlid].status = 'finished';
    downloadQueue[dlid].reason = downloadQueue[dlid].xhr.statusText || 'unknown error';
    downloadQueue[dlid].xhr = undefined;
    downloadQueue[dlid].endTime = (new Date()).getTime();

    // waiting queue
    checkWaiting();
}

async function fxDownloadChanged(item)
{
    if (!fxDownloadQueue[item.id]) return;

    // finished
    if (item.state &&
        (item.state.current == 'complete'
         || item.state.current == 'interrupted')) {
        // objurl
        URL.revokeObjectURL(fxDownloadQueue[item.id].objurl);
        // blob
        fxDownloadQueue[item.id].blob = undefined;
        // update queue
        let dlid = fxDownloadQueue[item.id].dlid;
        downloadQueue[dlid].status = 'finished';
        if (item.state.current == 'complete')
            downloadQueue[dlid].reason = 'complete';
        else if (item.state.current == 'interrupted')
            downloadQueue[dlid].reason = 'interrupted';
        downloadQueue[dlid].xhr = undefined;
        downloadQueue[dlid].endTime = (new Date()).getTime();

        // clear from fx download list
        await browser.downloads.erase({ id : item.id });
        // queue
        delete fxDownloadQueue[item.id];

        // waiting queue
        checkWaiting();
    }
    // crash
    else if (item.error) {
        // retry failed
        if (fxDownloadQueue[item.id].retry) {
            // objurl
            URL.revokeObjectURL(fxDownloadQueue[item.id].objurl);
            // blob
            fxDownloadQueue[item.id].blob = undefined;
            // update queue
            let dlid = fxDownloadQueue[item.id].dlid;
            downloadQueue[dlid].status = 'finished';
            downloadQueue[dlid].reason = 'failed to create file';
            downloadQueue[dlid].xhr = undefined;
            downloadQueue[dlid].endTime = (new Date()).getTime();

            // clear from fx download list
            await browser.downloads.erase({ id : item.id });
            // queue
            delete fxDownloadQueue[item.id];

            // waiting queue
            checkWaiting();
        }
        // retry
        else {
            // download created object
            var itemid = await browser.downloads.download({
                url : fxDownloadQueue[item.id].objurl,
                saveAs : false,
                filename : fxDownloadQueue[item.id].filename
            });

            fxDownloadQueue[itemid] = {
                objurl : fxDownloadQueue[item.id].objurl,
                blob : fxDownloadQueue[item.id].blob,
                dlid : fxDownloadQueue[item.id].dlid,
                filename : fxDownloadQueue[item.id].filename,
                retry : true
            };
            // clear from fx download list
            await browser.downloads.erase({ id : item.id });
            // queue
            delete fxDownloadQueue[item.id];
        }
    }
}

function configChanged(changes, area)
{
    if (area != 'local') return;
    const key = Object.keys(changes)[0];

    switch (key) {
    case 'simultaneous-whole':
        simultaneousCounts['whole'] = changes[key].newValue;
        break;
    case 'simultaneous-per-server':
        simultaneousCounts['per-server'] = changes[key].newValue;
        break;
    default:
    }

    // waiting queue
    checkWaiting();
}

function checkWaiting()
{
    // update badge
    updateBadge();

    const waiting = searchQueue({ status : 'waiting' });
    for (let q of waiting) {
        if ((searchQueue({ status : 'downloading' })).length >= simultaneousCounts['whole']) return;
        else if ((searchQueue({ status : 'downloading', originalDomain : q.originalDomain })).length >= simultaneousCounts['per-server']) return;
        // run
        else {
            downloadQueue[q.id].status = 'downloading',
            downloadQueue[q.id].xhr.send();
            downloadQueue[q.id].startTime = (new Date()).getTime();
        }
    }
}

function updateBadge()
{
    var downloading = searchQueue({ status : 'downloading' }).length,
        waiting = searchQueue({ status : 'waiting' }).length;
    if (downloading + waiting)
        browser.browserAction.setBadgeText({ text : downloading + '/' + (downloading + waiting) });
    else
        browser.browserAction.setBadgeText({ text : '' });
}

// location operations
function normalizeLocation(loc)
{
    return loc.replace(/\\/g, '/').replace(/([^/])$/, '$1/');
}

function replaceTags(path, targetUrl, refererUrl)
{
    const replaceMap = {
        ':Y:' :       () => (new Date()).getFullYear(),
        ':M:' :       () => ((new Date()).getMonth() + 1).toString().padStart(2, '0'),
        ':D:' :       () => (new Date()).getDate().toString().padStart(2, '0'),
        ':h:' :       () => (new Date()).getHours().toString().padStart(2, '0'),
        ':m:' :       () => (new Date()).getMinutes().toString().padStart(2, '0'),
        ':s:' :       () => (new Date()).getSeconds().toString().padStart(2, '0'),
        ':dom:' :     () => (new URL(targetUrl)).hostname,
        ':path:' :    () => { var path = (/^\/(.*\/)*/.exec((new URL(targetUrl)).pathname))[1]; return path ? path.slice(0, -1) : ''; },
        ':refdom:' :  () => (new URL(refererUrl)).hostname,
        ':refpath:' : () => { var path = (/^\/(.*\/)*/.exec((new URL(refererUrl)).pathname))[1]; return path ? path.slice(0, -1) : ''; }
    };
    return path.replace(/(:.+?:)/g, (tag) => replaceMap[tag]()).replace(/\/\//g, '/');
}
