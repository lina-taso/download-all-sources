/**
 * @fileOverview Download All Sources main script
 * @name das-main.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

browser.downloads.onChanged.addListener(fxDownloadChanged);
browser.downloads.onErased.addListener(fxDownloadErased);
browser.storage.onChanged.addListener(configChanged);

let DEBUG;
const DEFAULT_FILENAME  = 'download',
      DEFAULT_EXTENSION = 'no-ext',
      DEFAULT_MIME      = { 'sample/mime-type' : 'mext' },
      RETRY_WAIT        = 5000,
      TILE_SIZE         = 400;

var lastid = 0,
    downloadQueue   = [],
    fxDownloadQueue = [];

var config = {
    _config : {},
    getPref : function(key)
    {
        return key == null ? this._config : this._config[key];
    },
    setPref : function(key, val)
    {
        if (!key) return Promise.reject();

        if (val == null)
            return browser.storage.local.remove(key);
        else {
            let obj = {};
            obj[key] = val;
            return browser.storage.local.set(obj);
        }
    },
    update : async function()
    {
        this._config = Object.assign({}, defaultconfig, await browser.storage.local.get());
    }
};

(async () => {
    await config.update();
})();


// download file
async function downloadFile(url, requestHeaders, locs, names, option)
{
    const dlid = lastid++;

    // check download count
    let status = 'downloading';
    const domain = (new URL(url)).hostname;
    if (searchQueue({ status : 'downloading' }).length >= config.getPref('simultaneous-whole'))
        status = 'waiting';
    else if (searchQueue({ status : 'downloading', originalDomain : domain }).length
             >= config.getPref('simultaneous-per-server'))
        status = 'waiting';

    // queuing
    downloadQueue[dlid] = {
        id             : dlid,
        fxid           : null,
        regTime        : (new Date()).getTime(),
        startTime      : null,
        endTime        : null,
        status         : status,
        reason         : '',
        data           : [],
        option         : JSON.parse(JSON.stringify(option)),
        resumeEnabled  : false,
        originalUrl    : url,
        originalDomain : domain,
        // if location is specified, last character must be '/'|'\\'
        location       : locs.location,
        originalLocation : locs.originalLocation,
        filename       : names.filename,
        originalFilename : names.originalFilename,
        autoFilename   : '',
        responseUrl    : '',
        responseFilename : '',
        contentType    : '',
        requestHeaders : JSON.parse(JSON.stringify(requestHeaders)),
        // if total is 0, download is not started or total size is unknown
        total          : 0,
        loaded         : () => {
            const loaded     = downloadQueue[dlid].data.reduce((acc, cur) => acc + cur.loaded, 0);
            const prevLoaded = downloadQueue[dlid].prevLoaded,
                  prevTime   = downloadQueue[dlid].prevTime,
                  nowTime    = (new Date()).getTime();

            // prev is old
            if (nowTime - prevTime > 2000) {
                downloadQueue[dlid].prevLoaded = loaded;
                downloadQueue[dlid].prevTime   = nowTime;
                downloadQueue[dlid].Bps        = (loaded - prevLoaded) / (nowTime - prevTime) * 1000;
            }
            return { now : loaded, nowTime : nowTime,  prev : prevLoaded, prevTime : prevTime, Bps : downloadQueue[dlid].Bps };
        },
        prevLoaded     : 0,
        prevTime       : null,
        Bps            : 0,
        detail         : () => {
            const queue  = downloadQueue[dlid];

            // completed
            if (queue.status == 'downloaded' || queue.reason == 'complete' || queue.reason == 'interrupted')
                return [...Array(TILE_SIZE)].fill('loaded', 0, TILE_SIZE);

            // downloading size unknown file
            if (!queue.total)
                return [...Array(TILE_SIZE)].fill('unknown', 0, TILE_SIZE);

            // downloading size known file
            const detail = [...Array(TILE_SIZE)];
            for (let datum of queue.data) {
                const firstBlock = Math.ceil(datum.rangeStart * TILE_SIZE / queue.total),
                      lastBlock  = Math.floor((datum.rangeStart + datum.loaded) * TILE_SIZE / queue.total),
                      nextBlock  = (datum.rangeStart + datum.loaded) * TILE_SIZE % queue.total > 0;
                detail.fill('loaded', firstBlock, nextBlock ? lastBlock+1 : lastBlock);
            }
            return detail;
        }
    };

    // start downloading
    if (status == 'downloading') {
        let now = (new Date()).getTime();
        downloadQueue[dlid].data.push(createXhr(dlid, 0));
        downloadQueue[dlid].startTime = now;
        downloadQueue[dlid].prevTime  = now;
    }

    // update badge
    updateBadge();
}

function createXhr(dlid, index, start, end)
{
    const queue       = downloadQueue[dlid],
          splitCount  = config.getPref('split-count'),
          splitSize   = config.getPref('split-size') * 1024 * 1024,
          splitExSize = config.getPref('split-ex-size') * 1024 * 1024;

    // xhr
    const datum = {
        status     : '',
        xhr        : new XMLHttpRequest(),
        blob       : null,
        rangeStart : start || 0,
        rangeEnd   : end || null,
        loaded     : 0,
        retry      : 0,
        retrytimer : null
    };

    // xhr events
    datum.xhr.addEventListener('load',     onload);  // completed
    datum.xhr.addEventListener('abort',    onabort); // manually stop
    datum.xhr.addEventListener('timeout',  ontimeout);
    datum.xhr.addEventListener('error',    onerror);
    datum.xhr.addEventListener('progress', onprogress);

    // init
    if (index == 0)
        // readystatechange
        datum.xhr.addEventListener('readystatechange', onreadystatechange);

    datum.xhr.open('GET', queue.responseUrl || queue.originalUrl);
    datum.xhr.responseType = 'blob';
    queue.requestHeaders.forEach(header => datum.xhr.setRequestHeader(header.name, header.value));

    // range
    if (end) datum.xhr.setRequestHeader('Range', 'bytes=' + start + '-' + end);

    datum.xhr.send();
    datum.status = 'downloading';

    DEBUG && console.log({ dlid : dlid, index : index, message : 'download started.' });

    return datum;

    function onload(e)
    {
        // check downloaded size
        if (datum.rangeEnd && datum.rangeEnd - datum.rangeStart + 1 != this.response.size) {
            DEBUG && console.log({ dlid : dlid, index : index, rangestart : datum.rangeStart, rangeend : datum.rangeEnd, loaded : datum.loaded, message : 'onload, size mismatch' });

            datum.status = 'size mismatch';
            datum.blob   = this.response;
            datum.loaded = this.response.size;
            datum.xhr    = undefined;
            retryPartialDownload(dlid, index);
            return;
        }

        DEBUG && console.log({ dlid : dlid, index : index, message : 'onload' });

        // download has been finished before firing onreadystatechange
        if (!queue.responseUrl) {
            DEBUG && console.log({ dlid : dlid, index : index, message : 'onload2' });

            // update download queue (url & filename)
            let url = new URL(this.responseURL);
            queue.responseUrl = url;
            queue.responseFilename = url.pathname.match("/([^/]*)$")[1];
            // content type
            queue.contentType = this.getResponseHeader('content-type').split(';')[0].toLowerCase();

            // split filename and extension
            const filename = queue.responseFilename.split(/\.(?=[^.]+$)/);
            // replace tags for location
            if (queue.location) {
                queue.location = replaceTags({
                    path : queue.location,
                    name : filename[0],
                    ext  : filename[1] || DEFAULT_EXTENSION,
                    mime : queue.contentType
                });
            }
            // replace tags for filename
            if (queue.filename) {
                queue.filename = replaceTags({
                    path : queue.filename,
                    name : filename[0],
                    ext  : filename[1], // filename extension starting with a period
                    mime : queue.contentType
                }, true);
            }
        }

        // update progress
        datum.status = 'complete';
        datum.blob   = this.response;
        datum.loaded = this.response.size;
        datum.xhr    = undefined;

        // update download queue
        partialDownloadCompleted(dlid);
    }
    function onabort()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'onabort' });

        datum.status = 'abort';
        datum.xhr    = undefined;
    }
    function ontimeout()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'ontimeout' });

        datum.status = 'timeout';
        retryPartialDownload(dlid, index);
    }
    function onerror()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'onerror' });

        datum.status = 'error';
        retryPartialDownload(dlid, index);
    }
    function onprogress(e) { datum.loaded = e.loaded; }
    // for first xhr
    function onreadystatechange()
    {
        if (this.readyState != 2) return;
        this.removeEventListener('readystatechange', onreadystatechange);
        DEBUG && console.log({ dlid : dlid, index : index, message : 'readystate 2' });

        // update download queue (url & filename)
        const url = new URL(this.responseURL);
        queue.responseUrl = url;
        queue.responseFilename = url.pathname.match("/([^/]*)$")[1];
        // content type
        queue.contentType = this.getResponseHeader('content-type').split(';')[0].toLowerCase();

        // split filename and extension
        const filename = queue.responseFilename.split(/\.(?=[^.]+$)/);
        // replace tags for location
        if (queue.location) {
            queue.location = replaceTags({
                path : queue.location,
                name : filename[0],
                ext  : filename[1] || DEFAULT_EXTENSION,
                mime : queue.contentType
            });
        }
        // replace tags for filename
        if (queue.filename) {
            queue.filename = replaceTags({
                path : queue.filename,
                name : filename[0],
                ext  : filename[1], // filename extension starting with a period
                mime : queue.contentType
            }, true);
        }
        // total size
        queue.total = parseInt(this.getResponseHeader('content-length')) || 0;

        // manually disable resuming
        if (queue.option.disableResuming) {
            DEBUG && console.log({ dlid : dlid, index : index, message : 'manually disable resuming. initial download continued.' });
        }

        // resumable
        else if (queue.total > splitExSize // large file
            && this.getResponseHeader('accept-ranges') == 'bytes') { // range requestable

            queue.resumeEnabled = true;
            this.abort();

            DEBUG && console.log({ dlid : dlid, index : index, message : 'resumable. initial download aborted.' });

            // start multi-thread download
            const segBytes= queue.total >= splitSize * splitCount
                  ? splitSize : Math.floor(queue.total / splitCount);

            // 0th
            datum.rangeEnd = segBytes-1;
            restartXhr(dlid, index);
            DEBUG && console.log({ dlid : dlid, index : index, message : 'download re-started.' });

            if (splitCount == 1) return;
            // 1st...N-1th
            for (let i=1; i<splitCount-1; i++)
                queue.data.push(
                    createXhr(dlid, i, segBytes*i, segBytes*(i+1)-1)
                );
            // Nth
            queue.data.push(
                segBytes == splitSize
                // middle segment
                    ? createXhr(dlid, splitCount-1, segBytes*(splitCount-1), segBytes*splitCount-1)
                // last segment
                    : createXhr(dlid, splitCount-1, segBytes*(splitCount-1), queue.total-1)
            );
        } // resumable

        // resumable ?
        else if (queue.total > splitExSize // large file
            && this.getResponseHeader('accept-ranges') != 'none') { // range requestable ?

            queue.resumeEnabled = true;
            this.abort();

            DEBUG && console.log({ dlid : dlid, index : index, message : 'resumable? initial download aborted.' });

            // start multi-thread download
            const segBytes= queue.total >= splitSize * splitCount
                  ? splitSize : Math.floor(queue.total / splitCount);

            // 0th
            datum.rangeEnd = segBytes-1;
            datum.xhr = new XMLHttpRequest();
            // xhr events
            datum.xhr.addEventListener('load',     onload);  // completed
            datum.xhr.addEventListener('abort',    onabort); // manually stop
            datum.xhr.addEventListener('timeout',  ontimeout);
            datum.xhr.addEventListener('error',    onerror);
            datum.xhr.addEventListener('progress', onprogress);
            datum.xhr.addEventListener('readystatechange', onreadystatechange2);

            datum.xhr.open('GET', queue.responseUrl);
            datum.xhr.responseType = 'blob';
            queue.requestHeaders.forEach(header => datum.xhr.setRequestHeader(header.name, header.value));

            // range
            datum.xhr.setRequestHeader('Range', 'bytes=0-' + datum.rangeEnd);

            datum.xhr.send();
            datum.status = 'downloading';

            DEBUG && console.log({ dlid : dlid, index : index, message : '2nd download started.' });

            function onreadystatechange2()
            {
                if (this.readyState != 2) return;
                this.removeEventListener('readystatechange', onreadystatechange2);
                DEBUG && console.log({ dlid : dlid, index : index, message : '2nd readystate 2' });

                if (this.getResponseHeader('accept-ranges') == 'bytes') { // certainly range requestable

                    DEBUG && console.log({ dlid : dlid, index : index, message : 'certainly resumable.' });

                    // total size (content-range: bytes 0-123456/123457)
                    queue.total = parseInt(this.getResponseHeader('content-range').split('/')[1]);

                    if (splitCount == 1) return;
                    // 1st...N-1th
                    for (let i=1; i<splitCount-1; i++)
                        queue.data.push(
                            createXhr(dlid, i, segBytes*i, segBytes*(i+1)-1)
                        );
                    // Nth
                    queue.data.push(
                        segBytes == splitSize
                        // middle segment
                            ? createXhr(dlid, splitCount-1, segBytes*(splitCount-1), segBytes*splitCount-1)
                        // last segment
                            : createXhr(dlid, splitCount-1, segBytes*(splitCount-1), queue.total-1)
                    );
                }

                // not resumable -> continue download
                else
                    DEBUG && console.log({ dlid : dlid, index : index, message : 'not resumable. 2nd download continued.' });

            }
        } // resumable ?

        // non resumable -> continue download
        else
            DEBUG && console.log({ dlid : dlid, index : index, message : 'not resumable. initial download continued.' });
    }
}

function restartXhr(dlid, index)
{
    const queue = downloadQueue[dlid],
          datum = queue.data[index];

    datum.xhr = new XMLHttpRequest();
    // xhr events
    datum.xhr.addEventListener('load',     onload);  // completed
    datum.xhr.addEventListener('abort',    onabort); // manually stop
    datum.xhr.addEventListener('timeout',  ontimeout);
    datum.xhr.addEventListener('error',    onerror);
    datum.xhr.addEventListener('progress', onprogress);

    datum.xhr.open('GET', queue.responseUrl || queue.originalUrl);
    datum.xhr.responseType = 'blob';
    for (let header of queue.requestHeaders)
        datum.xhr.setRequestHeader(header.name, header.value);

    // range
    if (datum.rangeEnd) datum.xhr.setRequestHeader('Range', 'bytes=' + datum.rangeStart + '-' + datum.rangeEnd);

    datum.xhr.send();
    datum.status = 'downloading';

    function onload(e)
    {
        // check downloaded size
        if (datum.rangeEnd && datum.rangeEnd - datum.rangeStart + 1 != this.response.size) {
            DEBUG && console.log({ dlid : dlid, index : index, rangestart : datum.rangeStart, rangeend : datum.rangeEnd, loaded : datum.loaded, message : 'onload, size mismatch' });

            datum.status = 'size mismatch';
            datum.blob   = this.response;
            datum.loaded = this.response.size;
            datum.xhr    = undefined;
            retryPartialDownload(dlid, index);
            return;
        }

        DEBUG && console.log({ dlid : dlid, index : index, message : 'onload' });

        // download has been finished before firing onreadystatechange
        if (!queue.responseUrl) {
            DEBUG && console.log({ dlid : dlid, index : index, message : 'onload2' });

            // update download queue (url & filename)
            const url = new URL(this.responseURL);
            queue.responseUrl = url;
            queue.responseFilename = url.pathname.match("/([^/]*)$")[1];
            // content type
            queue.contentType = this.getResponseHeader('content-type').split(';')[0].toLowerCase();

            // split filename and extension
            const filename = queue.responseFilename.split(/\.(?=[^.]+$)/);
            // replace tags for location
            if (queue.location) {
                queue.location = replaceTags({
                    path : queue.location,
                    name : filename[0],
                    ext  : filename[1] || DEFAULT_EXTENSION,
                    mime : queue.contentType
                });
            }
            // replace tags for filename
            if (queue.filename) {
                queue.filename = replaceTags({
                    path : queue.filename,
                    name : filename[0],
                    ext  : filename[1], // filename extension starting with a period
                    mime : queue.contentType
                }, true);
            }
        }

        // update progress
        datum.status = 'complete';
        datum.blob   = this.response;
        datum.loaded = this.response.size;
        datum.xhr    = undefined;

        // update download queue
        partialDownloadCompleted(dlid);
    }
    function onabort()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'onabort' });

        datum.status = 'abort';
        datum.xhr    = undefined;
    }
    function ontimeout()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'ontimeout' });

        datum.status = 'timeout';
        retryPartialDownload(dlid, index);
    }
    function onerror()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'onerror' });

        datum.status = 'error';
        retryPartialDownload(dlid, index);
    }
    function onprogress(e) { datum.loaded = e.loaded; }
}

async function retryPartialDownload(dlid, index)
{
    const queue = downloadQueue[dlid],
          datum = queue.data[index];

    if (datum.retry >= config.getPref('retry-count')) {
        DEBUG && console.log({ dlid : dlid, index : index, retry : datum.retry, message : 'give up retrying download' });

        // [ignore size mismatch] wait another partial downloads
        if (datum.status == 'size mismatch' && queue.option.ignoreSizemismatch)
            downloadFailed2(dlid, datum.status);
        // stop all partial downloads
        else
            downloadFailed(dlid, datum.status);
        return;
    }

    DEBUG && console.log({ dlid : dlid, index : index, retry : datum.retry, message : 'retry download waiting...' });

    // update progress
    datum.status = 'retrying';
    datum.loaded = 0;
    // wait
    await new Promise(resolve => { datum.retrytimer = setTimeout(resolve, RETRY_WAIT + (index == 0 ? 1000 : 0)); });
    datum.retrytimer = null;

    // retry
    datum.retry++;
    restartXhr(dlid, index);
}

function stopDownload(dlid)
{
    const queue = downloadQueue[dlid];

    if (queue.status == 'downloading')
        // abort all xhr
        queue.data.forEach(datum => {
            switch (datum.status) {
            case 'downloading':
                datum.xhr && datum.xhr.abort();
                break;
            case 'retrying':
                clearTimeout(datum.retrytimer);
                datum.status = 'abort';
                break;
            }
        });
    queue.data.forEach(datum => datum.blob = undefined);

    queue.status  = 'finished';
    queue.reason  = 'cancelled';
    queue.endTime = (new Date()).getTime();

    // waiting queue
    checkWaiting();
}

function pauseDownload(dlid)
{
    const queue = downloadQueue[dlid];
    if (queue.status == 'downloading')
        // abort all xhr
        queue.data.forEach((datum) => {
            switch (datum.status) {
            case 'downloading':
                datum.xhr && datum.xhr.abort();
                datum.loaded = 0;
                break;
            case 'retrying':
                clearTimeout(datum.retrytimer);
                datum.status = 'abort';
                datum.loaded = 0;
                break;
            }
        });
    queue.status  = 'paused';

    // waiting queue
    checkWaiting();
}

function resumeDownload(dlid)
{
    const queue = downloadQueue[dlid];
    if (queue.status == 'paused')
        // restart xhr
        queue.data.forEach((datum, index) => datum.status == 'abort' && restartXhr(dlid, index));
    queue.status  = 'downloading';
}

function deleteQueue(dlid)
{
    const loaded = downloadQueue[dlid].loaded();

    // fxdownloadqueue
    if (downloadQueue[dlid].fxid) {
        browser.downloads.erase({ id : downloadQueue[dlid].fxid });
    }

    downloadQueue[dlid] = {
        id     : dlid,
        status : 'deleted',
        loaded : () => loaded
    };
}

function searchQueue(query)
{
    let result = Array.from(downloadQueue);

    for (let key of Object.keys(query))
        result = result.filter(ele => ele[key] == query[key]);
    return result;
}

function partialDownloadCompleted(dlid)
{
    const queue       = downloadQueue[dlid],
          splitSize   = config.getPref('split-size') * 1024 * 1024,
          segments    = queue.data.length,
          lastSegSize = queue.data[segments-1].rangeEnd;

    DEBUG && console.log({ dlid : dlid, lastSegSize : lastSegSize, message : 'partially completed.' });

    // download failed (reason is entered) but waiting the download that has already started
    if (queue.reason) {
        // check other running downloads
        if (queue.data.filter(datum => datum.status == 'downloading' || datum.status == 'retrying').length > 0) return;

        // all downloads finished
        // merge blobs
        const blob = new Blob(queue.data.map(datum => { return datum.blob === undefined ? new Blob() : datum.blob; }));
        queue.data.forEach(datum => datum.blob = undefined);
        // complete
        downloadCompleted(dlid, blob);
    }

    else {
        // there is area not started
        if (lastSegSize && queue.total-1 > lastSegSize) {
            // start next download segment
            if (queue.total >= lastSegSize + splitSize)
                queue.data.push(
                    createXhr(dlid, segments, lastSegSize+1, lastSegSize+splitSize)
                );
            // start last download segment
            else
                queue.data.push(
                    createXhr(dlid, segments, lastSegSize+1, queue.total-1)
                );
            return;
        }

        // check other running downloads
        if (queue.data.filter(datum => datum.status != 'complete').length > 0) return;

        // all downloads finished
        // total size (if unknown file size)
        if (!queue.total) queue.total = queue.data[0].loaded;
        // merge blobs
        const blob = new Blob(queue.data.map(datum => datum.blob));
        queue.data.forEach(datum => datum.blob = undefined);
        // complete
        downloadCompleted(dlid, blob);
    }
}

async function downloadCompleted(dlid, blob)
{
    DEBUG && console.log({ dlid : dlid, message : 'download completed.' });

    const queue = downloadQueue[dlid];

    // filename
    let filename;
    // specified filename
    if (queue.filename) {
        // starting with period
        if (/^\./.test(queue.filename))
            filename = queue.location + (queue.autoFilename = DEFAULT_FILENAME + queue.filename);
        else
            filename = queue.location + queue.filename;
    }
    // url's leafname
    else if (queue.responseFilename) {
        // starting with period
        if (/^\./.test(queue.responseFilename))
            filename = queue.location + (queue.autoFilename = DEFAULT_FILENAME + queue.responseFilename);
        else
            filename = queue.location + queue.responseFilename;
    }
    // noname
    else {
        if (blob.type == 'text/html')
            filename = queue.location + (queue.autoFilename = DEFAULT_FILENAME + '.html');
        else
            filename = queue.location + (queue.autoFilename = DEFAULT_FILENAME);
    }

    // random wait
    await new Promise(resolve => { setTimeout(resolve, Math.floor(Math.random() * 1000)); });

    // download created object
    const objurl = URL.createObjectURL(blob);
    const itemid = await browser.downloads.download({
        url      : objurl,
        saveAs   : false,
        filename : filename
    });

    // update queue
    queue.status = 'downloaded';

    fxDownloadQueue[itemid] = {
        objurl   : objurl,
        blob     : blob,
        dlid     : dlid,
        filename : filename,
        retry    : false,
        reason   : queue.reason
    };
}

function downloadFailed(dlid, reason)
{
    DEBUG && console.log({ dlid : dlid, message : 'download failed.' });

    const queue = downloadQueue[dlid];

    // abort all xhr
    queue.data.forEach((datum) => {
        switch (datum.status) {
        case 'downloading':
            datum.xhr && datum.xhr.abort();
            break;
        case 'retrying':
            clearTimeout(datum.retrytimer);
            datum.status = 'abort';
            break;
        }
    });

    queue.status  = 'finished';
    queue.reason  = reason || 'unknown error';
    queue.endTime = (new Date()).getTime();

    // waiting queue
    checkWaiting();
}

function downloadFailed2(dlid, reason)
{
    DEBUG && console.log({ dlid : dlid, message : 'download failed but waiting other partial download completed.' });

    const queue = downloadQueue[dlid];
    queue.reason = reason;

    let found = false;
    queue.data.forEach(datum => {
        if (!found && datum.status == reason) {
            found = true;
            queue.reason = reason;
            return;
        }
        else {
            // stop all xhr after the first size mismatch download
            switch (datum.status) {
            case 'downloading':
                // wait incomplete downloads
                if (!found) return;

                datum.xhr && datum.xhr.abort();
                datum.loaded = 0;
                break;
            case 'retrying':
                // wait incomplete downloads
                if (!found) return;

                clearTimeout(datum.retrytimer);
                datum.status = 'abort';
                datum.loaded = 0;
                break;
            default:
                datum.status = 'abort';
                datum.loaded = 0;
                datum.blob   = undefined;
                break;
            }
        }
    });

    partialDownloadCompleted(dlid);
}

async function fxDownloadChanged(item)
{
    if (!fxDownloadQueue[item.id]) return;

    const fxqueue = fxDownloadQueue[item.id],
          dlid    = fxqueue.dlid,
          queue   = downloadQueue[dlid];

    // finished
    if (item.state && (item.state.current == 'complete' || item.state.current == 'interrupted')) {
        // objurl
        URL.revokeObjectURL(fxqueue.objurl);
        // blob
        fxqueue.blob = undefined;
        // update queue
        queue.status  = 'finished';
        queue.reason  = queue.reason || item.state.current;
        queue.endTime = (new Date()).getTime();

        if (config.getPref('enable-openfile'))
            queue.fxid    = item.id;
        else {
            // clear from fx download list
            await browser.downloads.erase({ id : item.id });
        }

        // waiting queue
        checkWaiting();
    }
    // crash
    else if (item.error) {
        // retry failed
        if (fxqueue.retry) {
            // objurl
            URL.revokeObjectURL(fxqueue.objurl);
            // blob
            fxqueue.blob = undefined;
            // update queue
            queue.status  = 'finished';
            queue.reason  = 'failed to create file';
            queue.endTime = (new Date()).getTime();

            // clear from fx download list
            await browser.downloads.erase({ id : item.id });

            // waiting queue
            checkWaiting();
        }
        // retry
        else {
            // download created object
            let itemid = await browser.downloads.download({
                url      : fxqueue.objurl,
                saveAs   : false,
                filename : fxqueue.filename
            });
            fxDownloadQueue[itemid] = {
                objurl   : fxqueue.objurl,
                blob     : fxqueue.blob,
                dlid     : fxqueue.dlid,
                filename : fxqueue.filename,
                retry    : true
            };
            // clear from fx download list
            await browser.downloads.erase({ id : item.id });
        }
    }
}

async function fxDownloadErased(itemid)
{
    if (!fxDownloadQueue[itemid]) return;

    const fxqueue = fxDownloadQueue[itemid],
          dlid    = fxqueue.dlid,
          queue   = downloadQueue[dlid];

    // update queue
    queue.fxid = null;
    delete fxDownloadQueue[itemid];
}

async function configChanged(changes, area)
{
    if (area != 'local') return;
    await config.update();
    // waiting queue
    checkWaiting();
}

function checkWaiting()
{
    // update badge
    updateBadge();

    const waiting = searchQueue({ status : 'waiting' });
    for (let q of waiting) {
        if ((searchQueue({ status : 'downloading' })).length >= config.getPref('simultaneous-whole')) return;
        else if ((searchQueue({ status : 'downloading', originalDomain : q.originalDomain })).length
                 >= config.getPref('simultaneous-per-server')) continue;
        // run
        else {
            let now = (new Date()).getTime();
            downloadQueue[q.id].status = 'downloading',
            downloadQueue[q.id].data.push(createXhr(q.id, 0));
            downloadQueue[q.id].startTime = now;
            downloadQueue[q.id].prevTime  = now;
        }
    }
}

function updateBadge()
{
    let downloading = searchQueue({ status : 'downloading' }).length,
        waiting     = searchQueue({ status : 'waiting' }).length;
    if (downloading + waiting)
        browser.browserAction.setBadgeText({ text : (downloading + waiting).toString() });
    else
        browser.browserAction.setBadgeText({ text : '' });
}

// location operations
function normalizeLocation(loc)
{
    return loc.replace(/\\/g, '/').replace(/([^/])$/, '$1/');
}

function replaceTags(param, forfile)
{
// TODO when a tag is undefined, the tag text will be disappeared.
    const replaceMap = {
        ':Y:'       : () => (new Date()).getFullYear(),
        ':M:'       : () => ((new Date()).getMonth() + 1).toString().padStart(2, '0'),
        ':D:'       : () => (new Date()).getDate().toString().padStart(2, '0'),
        ':h:'       : () => (new Date()).getHours().toString().padStart(2, '0'),
        ':m:'       : () => (new Date()).getMinutes().toString().padStart(2, '0'),
        ':s:'       : () => (new Date()).getSeconds().toString().padStart(2, '0'),
        ':dom:'     : () => (new URL(param.targetUrl || null)).hostname,
        ':path:'    : () => { const path = (/^\/(.*\/)*/.exec((new URL(param.targetUrl || null)).pathname))[1];
                              return path ? path.slice(0, -1) : ''; },
        ':refdom:'  : () => (new URL(param.refererUrl || null)).hostname,
        ':refpath:' : () => { const path = (/^\/(.*\/)*/.exec((new URL(param.refererUrl || null)).pathname))[1];
                              return path ? path.slice(0, -1) : ''; },
        ':tag:'     : () => param.tag === undefined ? ':tag:' : param.tag || '',
        ':title:'   : () => param.title.replace(/[/\\:,;*?"<>|]/g, '_'),
        ':name:'    : () => param.name === undefined ? ':name:' : param.name || '',
        ':ext:'     : () => param.ext === undefined ? ':ext:' :
            forfile ? param.ext ? '.' + param.ext : '' : param.ext || '',
        ':mime:'    : () => param.mime === undefined ? ':mime:' : param.mime || '',
        ':mext:'    : () => param.mime === undefined ? ':mext:' : mime2ext(param.mime || '', forfile) || DEFAULT_EXTENSION
    };
    return param.path.replace(/(:.+?:)/g, (tag) => replaceMap[tag]()).replace(/\/\//g, '/');
}

function mime2ext(mime, forfile)
{
    const mimeMap = Object.assign({}, config.getPref('mime-mappings'), DEFAULT_MIME),
          ext     = mimeMap[mime];
    return forfile ? ext ? '.' + ext : '' : ext || '';
}
