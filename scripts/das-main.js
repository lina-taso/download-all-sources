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
      DEFAULT_MIME      = 'application/octet-stream',
      DEFAULT_MIME_MAP  = { 'sample/mime-type' : 'mext' },
      DENY_FILESTRING   = /[\\/:*?"<>|]/g,
      RETRY_WAIT        = 5000,
      TILE_SIZE         = 400;

var lastid = 0,
    downloadQueue   = [],
    fxDownloadQueue = [],
    queueRestored = false,
    checkWaitingInterval = null;

let updateavailable = false,
    init = false,
    waitInit = [];

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

function finishInit()
{
    init = true;
    for (let w of waitInit) w();
}

async function initialized()
{
    if (init) return Promise.resolve();
    else return new Promise((resolve, reject) => {
        waitInit.push(resolve);
    });
}

(async () => {
    await config.update();
    finishInit();
    restoreQueue();
})();


// download file
async function downloadFile(url, requestHeaders, locs, names, option, restore)
{
    const dlid = lastid++;

    // check download count
    let status = 'downloading';
    const domain = (new URL(url)).hostname;
    let count;

    // restore
    if (restore && !config.getPref('autostart-on-restore')) {
        queueRestored = true;
        status = 'waiting';
        DEBUG && console.log({ dlid : dlid, message : `download queue restored. waiting by config.`});
    }
    // whole
    else if ((count = searchQueue({ status : 'downloading' }).length) >= config.getPref('simultaneous-whole')) {
        status = 'waiting';
        DEBUG && console.log({ dlid : dlid, message : `whole downloading count: ${count}. waiting.`});
    }
    else {
        const params = config.getPref('server-parameter'),
              subdomains = domain.split('.');

        // server specified
        if (params[domain]) {
            if ((count = searchQueue({ status : 'downloading', originalDomain : domain }).length) >= params[domain]['simultaneous']) {
                status = 'waiting';
                DEBUG && console.log({ dlid : dlid, message : `server ${domain} specified download count: ${count}. waiting.`});
            }
        }
        // server specified (starting with .)
        while (subdomains.shift()) {
            const targetdomain = '.' + subdomains.join('.');
            if (params[targetdomain]) {
                if ((count = searchQueue({ status : 'downloading', originalDomain : targetdomain }).length) >= params[targetdomain]['simultaneous']) {
                    status = 'waiting';
                    DEBUG && console.log({ dlid : dlid, message : `server subdomain ${targetdomain} specified download count: ${count}. waiting.`});
                }
                break;
            }
        }
        // same domain name
        if ((count = searchQueue({ status : 'downloading', originalDomain : domain }).length) >= config.getPref('simultaneous-per-server')) {
            status = 'waiting';
            DEBUG && console.log({ dlid : dlid, message : `same server download count: ${count}. waiting.`});
        }
    }

    // queuing
    downloadQueue[dlid] = {
        id               : dlid,
        fxid             : null,
        regTime          : (new Date()).getTime(),
        startTime        : null,
        endTime          : null,
        status           : status,
        reason           : '',
        data             : [],
        option           : structuredClone(option),
        resumeEnabled    : false,
        originalUrl      : new URL(url),
        originalUrlInput : url,
        originalDomain   : domain,
        // if location is specified, last character must be '/'|'\\'
        location         : locs.location,
        originalLocation : locs.originalLocation,
        filename         : names.filename,
        originalFilename : names.originalFilename,
        autoFilename     : '',
        responseUrl      : null,
        responseFilename : '',
        contentType      : '',
        requestHeaders   : structuredClone(requestHeaders),
        // if total is 0, download is not started or total size is unknown
        total            : 0,
        get loaded() {
            const loaded     = this.data.reduce((acc, cur) => acc + cur.loaded, 0);
            const prevLoaded = this.prevLoaded,
                  prevTime   = this.prevTime,
                  nowTime    = (new Date()).getTime();

            // prev is old
            if (nowTime - prevTime > 2000) {
                this.prevLoaded = loaded;
                this.prevTime   = nowTime;
                this.Bps        = (loaded - prevLoaded) / (nowTime - prevTime) * 1000;
            }
            return { now : loaded, nowTime : nowTime,  prev : prevLoaded, prevTime : prevTime, Bps : this.Bps };
        },
        prevLoaded       : 0,
        prevTime         : null,
        Bps              : 0,
        splitCount : function() {
            const params     = config.getPref('server-parameter'),
                  subdomains = domain.split('.');
            // server specified
            if (params[domain]) {
                return params[domain]['split-count'];
            }
            // server specified (starting with .)
            while (subdomains.shift()) {
                const targetdomain = '.' + subdomains.join('.');
                if (params[targetdomain]) {
                    return params[targetdomain]['split-count'];
                }
            }
            // default
            return config.getPref('split-count');
        }(),
        disableResuming : function() {
            const params     = config.getPref('server-parameter'),
                  subdomains = domain.split('.');
            // server specified
            if (params[domain]) {
                return params[domain]['disable-resuming'] || option.disableResuming;
            }
            // server specified (starting with .)
            while (subdomains.shift()) {
                const targetdomain = '.' + subdomains.join('.');
                if (params[targetdomain]) {
                    return params[targetdomain]['disable-resuming'] || option.disableResuming;
                }
            }
            // default
            return option.disableResuming;
        }(),
        ignoreSizemismatch : function() {
            const params     = config.getPref('server-parameter'),
                  subdomains = domain.split('.');
            // server specified
            if (params[domain]) {
                return params[domain]['ignore-sizemismatch'] || option.ignoreSizemismatch;
            }
            // server specified (starting with .)
            while (subdomains.shift()) {
                const targetdomain = '.' + subdomains.join('.');
                if (params[targetdomain]) {
                    return params[targetdomain]['ignore-sizemismatch'] || option.ignoreSizemismatch;
                }
            }
            // default
            return option.ignoreSizemismatch;
        }(),
        get detail() {
            // completed
            if (this.status == 'downloaded' || this.reason == 'complete' || this.reason == 'interrupted')
                return [...Array(TILE_SIZE)].fill('loaded', 0, TILE_SIZE);

            // m3u8 file
            if (this.mode == 'm3u8' && this.m3u8) {
                const detail = [...Array(TILE_SIZE)];
                for (let i = 1; i<this.data.length; i++) {
                    const firstBlock = Math.ceil((i-1) * TILE_SIZE / this.m3u8.length),
                          lastBlock  = Math.floor(i * TILE_SIZE / this.m3u8.length),
                          nextBlock  = i * TILE_SIZE % this.m3u8.length > 0;
                    detail.fill('loaded', firstBlock, nextBlock ? lastBlock+1 : lastBlock);
                }
                return detail;
            }

            // downloading size unknown file
            if (!this.total)
                return [...Array(TILE_SIZE)].fill('unknown', 0, TILE_SIZE);

            // downloading size known file
            const detail = [...Array(TILE_SIZE)];
            for (let datum of this.data) {
                const firstBlock = Math.ceil(datum.rangeStart * TILE_SIZE / this.total),
                      lastBlock  = Math.floor((datum.rangeStart + datum.loaded) * TILE_SIZE / this.total),
                      nextBlock  = (datum.rangeStart + datum.loaded) * TILE_SIZE % this.total > 0;
                detail.fill('loaded', firstBlock, nextBlock ? lastBlock+1 : lastBlock);
            }
            return detail;
        },
        get authentication() {
            switch (this.finalAuthentication[0]) {
            case 'option':
            case 'response':
                return this.finalAuthentication.slice(1);
            case 'original':
                if (!this.responseUrl)
                return this.finalAuthentication.slice(1);
            }

            const params = config.getPref('authentication-parameter');

            // queue specified
            if (this.option.authentication[0]) {
                this.finalAuthentication = ['option', ...this.option.authentication];
                return this.option.authentication;
            }

            // url specified
            let target   = null;
            const punyurls        = Object.keys(params),
                  originalPunyUrl = this.originalUrl.href;

            for (let punyurl of punyurls) {
                // directory (forward match)
                if (/\/$/.test(punyurl)) {
                    if ((new RegExp('^' + punyurl, 'i')).test(this.responseUrl || originalPunyUrl)) {
                        if (!(target && punyurl.split('/').length < target[0])) {
                            target = [punyurl.split('/').length, punyurl];
                        }}}
                // file (exact match)
                else {
                    if ((new RegExp('^' + punyurl + '$', 'i')).test(this.responseUrl || originalPunyUrl)) {
                        this.finalAuthentication = [this.responseUrl ? 'response' : 'original', params[punyurl].user, params[punyurl].pass];
                        return [params[punyurl].user, params[punyurl].pass];
                    }}}

            // directory
            if (target) {
                this.finalAuthentication = [this.responseUrl ? 'response' : 'original', params[target[1]].user, params[target[1]].pass];
                return [params[target[1]].user, params[target[1]].pass];
            }

            this.finalAuthentication = [this.responseUrl ? 'response' : 'original', '', ''];
            return ['', ''];
        },
        finalAuthentication : ['', '', ''],
        get mode() {
            return this.option.mode ? this.option.mode : 'normal';
        }
    };

    // start downloading
    if (status == 'downloading') startQueue(dlid);

    // update badge
    updateBadge();
    // save queue
    saveQueue();
}

function startQueue(dlid)
{
    const now = (new Date()).getTime();
    downloadQueue[dlid].status = 'downloading';
    downloadQueue[dlid].data.push(createXhr(dlid, 0));
    downloadQueue[dlid].startTime = now;
    downloadQueue[dlid].prevTime  = now;
}

function createXhr(dlid, index, start, end)
{
    const queue       = downloadQueue[dlid],
          splitCount  = queue.splitCount,
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

    // m3u8 mode
    if (index != 0 && queue.mode == 'm3u8')
        datum.xhr.open('GET', new URL(queue.m3u8[index-1], queue.responseUrl || queue.originalUrl), true, ...queue.authentication);
    // normal mode
    else
        datum.xhr.open('GET', queue.responseUrl || queue.originalUrl, true, ...queue.authentication);

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
        datum.blob   = this.response;
        datum.loaded = this.response.size;
        datum.xhr    = undefined;

        // for m3u8
        if (queue.mode == 'm3u8') { onload_m3u8.apply(this); return; }

        // check downloaded size
        if (datum.rangeEnd && datum.rangeEnd - datum.rangeStart + 1 != this.response.size) {
            DEBUG && console.log({ dlid : dlid, index : index, rangestart : datum.rangeStart, rangeend : datum.rangeEnd, loaded : datum.loaded, message : 'onload, size mismatch' });

            datum.status = 'size mismatch';
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
            queue.contentType = (this.getResponseHeader('content-type') ? this.getResponseHeader('content-type') : DEFAULT_MIME).split(';')[0].toLowerCase();

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

        // for m3u8
        if (queue.mode === 'm3u8') return;

        // update download queue (url & filename)
        const url = new URL(this.responseURL);
        queue.responseUrl = url;
        queue.responseFilename = url.pathname.match("/([^/]*)$")[1];
        // content type
        queue.contentType = (this.getResponseHeader('content-type') ? this.getResponseHeader('content-type') : DEFAULT_MIME).split(';')[0].toLowerCase();

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
        if (queue.disableResuming) {
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
                  ? splitSize : Math.ceil(queue.total / splitCount);

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
                  ? splitSize : Math.ceil(queue.total / splitCount);

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

            datum.xhr.open('GET', queue.responseUrl, true, ...queue.authentication);
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
    async function onload_m3u8()
    {
        DEBUG && console.log({ dlid : dlid, index : index, message : 'm3u8 mode. onload' });

        // first download (m3u8 file)
        if (!queue.responseUrl) {
            // check whether readble m3u8 file
            const m3u8Text = await datum.blob.text();
            if (!/#EXTINF/i.test(m3u8Text)) {
                DEBUG && console.log({ dlid : dlid, index : index, loaded : datum.loaded, message : 'm3u8 mode. onload, imcompatible m3u8 file' });

                datum.status = 'imcompatible m3u8 file';
                downloadFailed(dlid, datum.status);
                return;
            }

            DEBUG && console.log({ dlid : dlid, index : index, message : 'm3u8 mode. onload2' });

            // update download queue (url & filename)
            const url = new URL(this.responseURL);
            queue.responseUrl = url;
            queue.responseFilename = url.pathname.match("/([^/]*)$")[1];
            // the content-type will be updated and the filename/location tags will be replaced when the first M3U8 segment is downloaded.

            // total size
            queue.total = 0;

            // resumable
            queue.resumeEnabled = true;
            DEBUG && console.log({ dlid : dlid, index : index, message : 'm3u8 mode. resumable.' });

            // update progress
            datum.status = 'complete';

            // register m3u8 segument urls
            queue.m3u8 = [];
            m3u8Text.split(/\n|\r\n/).filter(ele => ele != '').forEach((ele, i, arr) => {
                if (/^#EXTINF/i.test(ele) && arr[i+1]) queue.m3u8.push(arr[i+1]);
            });

            // start downloading m3u8 segments
            for (let i=1; i<=splitCount; i++)
                queue.data.push(
                    createXhr(dlid, i)
                );

            return;
        }

        // update progress
        datum.status = 'complete';

        if (index == 1) {
            // content type
            queue.contentType = (this.getResponseHeader('content-type') ? this.getResponseHeader('content-type') : DEFAULT_MIME).split(';')[0].toLowerCase();

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
            queue.filename = replaceTags({
                path : queue.filename || ':name::mext:',
                name : filename[0],
                ext  : filename[1], // filename extension starting with a period
                mime : queue.contentType
            }, true);
        }

        // update download queue
        partialDownloadCompleted_m3u8(dlid);
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

    datum.xhr.open('GET', queue.responseUrl || queue.originalUrl, true, ...queue.authentication);
    datum.xhr.responseType = 'blob';
    for (let header of queue.requestHeaders)
        datum.xhr.setRequestHeader(header.name, header.value);

    // range
    if (datum.rangeEnd) datum.xhr.setRequestHeader('Range', 'bytes=' + datum.rangeStart + '-' + datum.rangeEnd);

    datum.xhr.send();
    datum.status = 'downloading';

    function onload(e)
    {
        datum.blob   = this.response;
        datum.loaded = this.response.size;
        datum.xhr    = undefined;

        // check downloaded size
        if (datum.rangeEnd && datum.rangeEnd - datum.rangeStart + 1 != this.response.size) {
            DEBUG && console.log({ dlid : dlid, index : index, rangestart : datum.rangeStart, rangeend : datum.rangeEnd, loaded : datum.loaded, message : 'onload, size mismatch' });

            datum.status = 'size mismatch';
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
            queue.contentType = (this.getResponseHeader('content-type') ? this.getResponseHeader('content-type') : DEFAULT_MIME).split(';')[0].toLowerCase();

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
        if (datum.status == 'size mismatch' && queue.ignoreSizemismatch)
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

    switch (queue.status) {
    case 'downloading':
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
        break;
    case 'downloaded':
        // abort fxdownload
        browser.downloads.cancel(queue.fxid);
        break;
    }
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

    // update badge
    updateBadge();
    // no save queue
}

function startDownload(dlid)
{
    const queue = downloadQueue[dlid];
    if (queue.status != 'waiting') return;

    startQueue(dlid);
    // update badge
    updateBadge();
    // save queue
    saveQueue();
}

function deleteQueue(dlid)
{
    const loaded = downloadQueue[dlid].loaded;

    // fxdownloadqueue
    if (downloadQueue[dlid].fxid) {
        browser.downloads.erase({ id : downloadQueue[dlid].fxid });
    }

    downloadQueue[dlid] = {
        id     : dlid,
        status : 'deleted',
        loaded : loaded
    };
}

function searchQueue(query)
{
    let result = Array.from(downloadQueue);
    const queries = Object.keys(query);

    for (let key of queries) {
        if (key == 'originalDomain' && /^\./.test(query[key]))
            result = result.filter(ele => ele[key].endsWith(query[key]));
        else
            result = result.filter(ele => ele[key] == query[key]);
    }
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

function partialDownloadCompleted_m3u8(dlid)
{
    const queue = downloadQueue[dlid];

    DEBUG && console.log({ dlid : dlid, message : 'm3u8 mode. partially completed.' });

    // check other running downloads
    if (queue.m3u8.length+1 > queue.data.length) {
        queue.data.push(
            createXhr(dlid, queue.data.length)
        );
        return;
    }

    // check other running downloads
    if (queue.data.filter(datum => datum.status != 'complete').length > 0) return;

    // all downloads finished
    // merge blobs
    const blob = new Blob(queue.data.slice(1).map(datum => datum.blob));
    queue.total = blob.size;
    queue.data.forEach(datum => datum.blob = undefined);
    // complete
    downloadCompleted(dlid, blob);
}

async function downloadCompleted(dlid, blob)
{
    DEBUG && console.log({ dlid : dlid, message : 'download completed.' });

    const queue = downloadQueue[dlid];

    // specified filename
    if (queue.filename) {
        let tempFilename = queue.filename.replaceAll(DENY_FILESTRING, '_').replace(/^[. ]+/, '').replace(/[. ]$/, '');
        if (!tempFilename) tempFilename = DEFAULT_FILENAME;
        if (queue.filename !== tempFilename) queue.autoFilename = tempFilename;
    }
    // url's leafname
    else if (queue.responseFilename) {
        let tempFilename = queue.responseFilename.replaceAll(DENY_FILESTRING, '_').replace(/^[. ]+/, '').replace(/[. ]$/, '');
        if (!tempFilename) tempFilename = DEFAULT_FILENAME;
        if (queue.responseFilename !== tempFilename) queue.autoFilename = tempFilename;
    }
    // noname
    else {
        if (blob.type == 'text/html')
            queue.autoFilename = DEFAULT_FILENAME + '.html';
        else
            queue.autoFilename = DEFAULT_FILENAME;
    }
    const filename = queue.location + (queue.autoFilename || queue.filename || queue.responseFilename);

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
    queue.fxid   = itemid;

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

        if (!config.getPref('enable-openfile')) {
            queue.fxid = null;
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
    DEBUG && console.log({ message : 'config changed.', changed : changes });
    if (area != 'local') return;
    await config.update();

    const keys   = Object.keys(changes),
          target = ['simultaneous-whole', 'simultaneous-per-server', 'server-parameter'];

    for (let key of keys) {
        if (target.includes(key)) {
            // counter config changed
            checkWaiting();
            break;
        }
    }
}

function saveQueue()
{
    const queue = searchQueue({ status : 'downloading' }).concat(
        searchQueue({ status : 'paused' }),
        searchQueue({ status : 'downloaded' }),
        searchQueue({ status : 'waiting' })
    ),
          saveQueue = [];

    for (let item of queue) {
        saveQueue.push({
            url            : item.originalUrlInput,
            requestHeaders : structuredClone(item.requestHeaders),
            locs           : { location : item.location, originaiLocation : item.originalLocation },
            names          : { filename : item.filename, originalFilename : item.originalFilename },
            option         : structuredClone(item.option)
        });
    }

    config.setPref('downloadQueue', saveQueue);
}

function restoreQueue()
{
    const queue = config.getPref('downloadQueue');
    for (let item of queue) {
        downloadFile(
            item.url,
            item.requestHeaders,
            item.locs,
            item.names,
            item.option,
            true
        );
    }
}

function checkWaiting()
{
    // interval
    if (checkWaitingInterval) {
        DEBUG && console.log({ message : 'update check waiting interval.' });

        clearTimeout(checkWaitingInterval);
        checkWaitingInterval = setTimeout(run, 200);
    }
    else {
        DEBUG && console.log({ message : 'set check waiting interval.' });
        checkWaitingInterval = setTimeout(run, 200);
    }

    function run()
    {
        // update badge
        updateBadge();
        // save queue
        saveQueue();

        const waiting = searchQueue({ status : 'waiting' });
        let count;

        ROOT: for (let q of waiting) {
            // whole
            if ((count = searchQueue({ status : 'downloading' }).length) >= config.getPref('simultaneous-whole')) {
                DEBUG && console.log({ message : `whole downloading count: ${count}. no download started.`});
                return;
            }

            const params = config.getPref('server-parameter'),
                  subdomains = q.originalDomain.split('.');

            // server specified
            if (params[q.originalDomain]) {
                if ((count = searchQueue({ status : 'downloading', originalDomain : q.originalDomain }).length) >= params[q.originalDomain]['simultaneous']) {
                    DEBUG && console.log({ dlid : q.id, message : `server ${q.originalDomain} specified download count: ${count}. skipped.`});
                    continue;
                }
            }
            // server specified (starting with .)
            while (subdomains.shift()) {
                const targetdomain = '.' + subdomains.join('.');
                if (params[targetdomain]) {
                    if ((count = searchQueue({ status : 'downloading', originalDomain : targetdomain }).length) >= params[targetdomain]['simultaneous']) {
                        DEBUG && console.log({ dlid : q.id, message : `server subdomain ${targetdomain} specified download count: ${count}. skipped.`});
                        continue ROOT;
                    }
                    break;
                }
            }
            // same domain name
            if ((count = searchQueue({ status : 'downloading', originalDomain : q.originalDomain }).length) >= config.getPref('simultaneous-per-server')) {
                DEBUG && console.log({ dlid : q.id, message : `same server download count: ${count}. skipped.`});
                continue;
            }

            // run
            startQueue(q.id);
        }

        // interval
        checkWaitingInterval = null;
        DEBUG && console.log({ message : 'check waiting done.' });
    }
}

function updateBadge()
{
    let downloading = searchQueue({ status : 'downloading' }).length,
        paused      = searchQueue({ status : 'paused' }).length,
        waiting     = searchQueue({ status : 'waiting' }).length;

    if (downloading + paused + waiting) {
        browser.browserAction.setBadgeText({ text : (downloading + paused + waiting).toString() });
        browser.runtime.onUpdateAvailable.addListener(onUpdateavailable);
    }
    else {
        browser.browserAction.setBadgeText({ text : '' });
        browser.runtime.onUpdateAvailable.removeListener(onUpdateavailable);
        if (updateavailable) browser.runtime.reload();
    }

    // prevent updating addon
    function onUpdateavailable() {
        console.log('Update available but download queue is active so update is holding.');
        updateavailable = true;
    }
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
    const mimeMap = Object.assign({}, config.getPref('mime-mappings'), DEFAULT_MIME_MAP),
          ext     = mimeMap[mime];
    return forfile ? ext ? '.' + ext : '' : ext || '';
}
