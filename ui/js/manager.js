/**
 * @fileOverview Download All Sources Manager content script
 * @name manager.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

// background
let bg;

// constants
const progressInterval = 2000,
      TILE_SIZE     = 400,
      PAGE_TITLE    = 'Download All Source Manager',
      allowProtocol = /^(https|http):/,
      allowUrl      = /^(https|http):\/\/([\\w-]+\\.)+[\\w-]+(\/[\\w./?%&=-]*)?$/,
      allowFilename = /^([^/\\:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|refdom|tag|title|name|ext):))*$/,
      allowLocation = /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|tag|name|ext):))*$/,
      denyLocation  = /(^\/)|(\.\/|\.\.\/|\/\/)/,
      defaultTitle  = 'no-title';

// valuables
let source     = [],
    prevLoaded = null, prevLoadedTime = null,
    baseurl,
    filter1, filter2, filter3, filter4, filter5, filter6;


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    localization();
    updateList();
    setInterval(updateList, progressInterval);
    $('#download-button').on('click', download);
    $('#source-download-button1, #source-download-button2').on('click', sourceDownload);
    $('#setting-button').on('click', () => { browser.runtime.openOptionsPage(); });
    $('#finished-delete-button')
        .on('click', function() {
            $('#finished-list').children('.download-item').each(function() {
                bg.deleteQueue(this.id.split('-')[1]);
                $(this).remove();
            });
        });
    // all tooltip enabled
    $('[data-toggle=tooltip]').tooltip({ title : function() {
        return browser.i18n.getMessage(this.dataset.titlestring);
    }});
    // item
    $('.item-resume-button').on('click', resumeDownload);
    $('.item-redo-button').on('click', reDownload);
    $('.item-delete-button')
        .on('click', function() {
            bg.deleteQueue(this.dataset.dlid);
            $('#item-' + this.dataset.dlid).remove();
        });

    // source list sort
    $('#sort-url, #sort-filetype, #sort-tag')
        .on('click', function() {
            const targets = ['sort-url', 'sort-filetype', 'sort-tag'];
            if (this.dataset.order == 'asc') this.dataset.order = 'desc';
            else if (this.dataset.order == 'desc') this.dataset.order = '';
            else this.dataset.order = 'asc';
            for (let target of targets)
                if (this.id != target) $('#' + target).attr('data-order', '');
            outputSourceList();
        });
    // filter
    $('#byTagname input, #byFiletype input, #byKeyword input, #filter-dup').on('input', function() {
        checkActiveFilter();
        outputSourceList();
    });
    // checkbox validation
    $('#dl-single-option1, #dl-multiple-option1, #dl-source-option1').on('input', checkDownloadOptions);

    // modal
    $('#new-download')
        .on('show.bs.modal', async function() {
            // initial value
            const config = await bg.config.getPref();
            // initial referer
            if (config['remember-new-referer'])
                $('#dl-single-referer, #dl-multiple-referer').val(config['new-referer-value']);
            // initial filename
            if (config['remember-new-filename'])
                $('#dl-single-filename').val(config['new-filename-value']);
            // initial location
            if (config['remember-new-location'])
                $('#dl-single-location, #dl-multiple-location').val(config['new-location-value']);
            // initial location sample
            $('#dl-single-location, #dl-multiple-location').each(function() { this.dispatchEvent(new Event('input')); });
        })
        .on('shown.bs.modal', function() { $(this).find('[data-focus=true]').focus(); });
    // modal
    $('#download-detail')
        .on('show.bs.modal', function(e) {
            const button = e.relatedTarget;
            // update dlid
            $('#download-detail, #detail-next-button, #detail-prev-button, #detail-stop-button, #detail-pause-button, #detail-resume-button, #detail-redo-button')
                .attr('data-dlid', button.dataset.dlid);
            // update detail
            updateDetail(true);
            $(this).attr('data-timer', setInterval(updateDetail, progressInterval));
        })
        .on('hidden.bs.modal', function() {
            // to stop animation
            $(this).attr('data-status', '');
            clearInterval($(this).attr('data-timer'));
        });
    // in detail modal
    $('#detail-resume-button').on('click', resumeDownload);
    $('#detail-redo-button').on('click', reDownload);
    $('#detail-next-button, #detail-prev-button').on('click', function() {
        let $target;

        if (this.id == 'detail-next-button')
            $target = $('#item-' + this.dataset.dlid).next();
        else
            $target = $('#item-' + this.dataset.dlid).prev();

        if ($target.length != 0) {
            // update dlid
            $('#download-detail, #detail-next-button, #detail-prev-button, #detail-stop-button, #detail-pause-button, #detail-resume-button, #detail-redo-button')
                .attr('data-dlid', $target.attr('id').split('-')[1]);
            // update detail
            updateDetail(true);
        }
    });
    $('#detail-status-detail').append(() => {
        const box   = [],
              $tile = $('<div class="detail-tile" data-status="" />');
        [...Array(TILE_SIZE)].forEach(() => { box.push($tile.clone()); });
        return box;
    });
    // modal
    $('#source-download')
        .on('show.bs.modal', async () => {
            // only once
            $('#source-all').on('input', function() {
                if (this.checked)
                    $('#source-list .source-item:not(#source-item-template) .source-url input').prop('checked', true);
                else
                    $('#source-list .source-item:not(#source-item-template) .source-url input').prop('checked', false);
                // count downloads
                $('#source-download-button1, #source-download-button2').attr(
                    'data-count',
                    $('#source-list .source-item:not(#source-item-template) .source-url input:checked').length
                );
            });
            $('#source-list').on('input', '.source-url input', function() {
                // count downloads
                $('#source-download-button1, #source-download-button2').attr(
                    'data-count',
                    $('#source-list .source-item:not(#source-item-template) .source-url input:checked').length
                );
            });
            $('#dl-source-referer-default').on('input', function() {
                if (this.checked)
                    $('#dl-source-referer').val(baseurl).prop('readonly', true).removeClass('is-invalid');
                else
                    $('#dl-source-referer').val('').prop('readonly', false);
            });
            // initial value
            const config = await bg.config.getPref();
            // filter-filetypes
            filter1 = new RegExp('^' + config['filetype1-extension'] + '$'),
            filter2 = new RegExp('^' + config['filetype2-extension'] + '$'),
            filter3 = new RegExp('^' + config['filetype3-extension'] + '$'),
            filter4 = new RegExp('^' + config['filetype4-extension'] + '$'),
            filter5 = new RegExp('^' + config['filetype5-extension'] + '$'),
            filter6 = new RegExp('^' + config['filetype6-extension'] + '$');
            // initial source-tagname
            if (config['remember-source-tagname'])
                $('#filter-tagnamelist').val(config['source-tagname-value']);
            // initial source-filetype
            if (config['remember-source-filetype'])
                config['source-filetype-value'].forEach((type) => { $('#filter-' + type).prop('checked', true); });
            // initial source-keyword
            if (config['remember-source-keyword']) {
                $('#filter-expression').val(config['source-keyword-value']);
                $('#filter-regex').prop('checked', config['source-regex-value']);
            }
            // initial source-referer
            if (!config['remember-source-referer'] || config['remember-source-referer'] && config['source-referer-default-value'])
                $('#dl-source-referer-default').click();
            else if (config['remember-source-referer']) {
                $('#dl-source-referer-default').prop('checked', false);
                $('#dl-source-referer').val(config['source-referer-value']);
            }
            // initial source-filename
            if (config['remember-source-filename'])
                $('#dl-source-filename').val(config['source-filename-value']);
            // initial source-location
            if (config['remember-source-location'])
                $('#dl-source-location').val(config['source-location-value']);
            // initial location sample
            $('#dl-source-filename')[0].dispatchEvent(new Event('input'));
            $('#dl-source-location')[0].dispatchEvent(new Event('input'));
            // tab color
            checkActiveFilter();
            outputSourceList(source);
        });
    // modal
    $('#confirm-dialog')
        .on('show.bs.modal', function(e) {
            const dlid = this.dataset.dlid = e.relatedTarget.dataset.dlid;

            switch (e.relatedTarget.dataset.action) {
            case 'stop':
                $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_download'));
                $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
                    .off('click')
                    .on('click', stopDownload);
                break;
            case 'pause':
                bg.downloadQueue[dlid].resumeEnabled
                    ? $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_pause_download_resumable'))
                    : $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_pause_download_nonresumable'));
                $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_pause'))
                    .off('click')
                    .on('click', pauseDownload);
                break;
            case 'stop-downloading':
                $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_downloading'));
                $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
                    .off('click')
                    .on('click', () => {
                        $('#downloading-list').children('.download-item:not(#download-item-template)').each(function() {
                            bg.stopDownload(this.id.split('-')[1]);
                        });
                    });
                break;
            case 'stop-waiting':
                $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_waiting'));
                $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
                    .off('click')
                    .on('click', () => {
                        $('#waiting-list').children('.download-item').each(function() {
                            bg.stopDownload(this.id.split('-')[1]);
                        });
                    });
                break;
            }
        })
        .on('shown.bs.modal', function() {
            $(this).find('[data-focus=true]').focus();
        });

    // url validation
    $('#dl-single-url, #dl-single-referer, #dl-multiple-referer, #dl-source-referer')
        .on('input', function() {
            if (!this.value) {
                $(this).toggleClass('is-invalid', false);
                return;
            }
            try {
                new URL(this.value);
                $(this).toggleClass('is-invalid', false);
            }
            catch (e) {
                $(this).toggleClass('is-invalid', true);
            }
        });
    $('#dl-multiple-url')
        .on('input', function() {
            if (!this.value) {
                $(this).toggleClass('is-invalid', false);
                return;
            }
            try {
                ($(this).val().split('\n')).forEach((line) => {
                    new URL(line);
                    $(this).toggleClass('is-invalid', false);
                });
            }
            catch (e) {
                $(this).toggleClass('is-invalid', true);
            }
        });
    // filename validation
    $('#dl-single-filename, #dl-source-filename')
        .on('input', function() {
            const valid = allowFilename.test(this.value);
            $(this).toggleClass('is-invalid', !valid);
            // sample
            if (valid) $('#' + this.id + '-sample').text(
                bg.replaceTags(
                    this.value,
                    'http://www.example.com/path/name/',
                    this.id == 'dl-source-filename' ? baseurl : '',
                    'tag',
                    'title',
                    'filename',
                    '.ext'
                ));
            else $('#' + this.id + '-sample').text('');
        });
    // location validation
    $('#dl-single-location, #dl-multiple-location, #dl-source-location')
        .on('input', async function() {
            const defaultLocation = await bg.config.getPref('download-location'),
                  location = bg.normalizeLocation(defaultLocation + this.value),
                  valid = allowLocation.test(location) && !denyLocation.test(location);
            $(this).toggleClass('is-invalid', !valid);
            // sample
            if (valid) $('#' + this.id + '-sample').text(
                bg.replaceTags(
                    location,
                    'http://www.example.com/path/name/',
                    this.id == 'dl-source-location' ? baseurl : '',
                    'tag',
                    'title',
                    'filename',
                    'ext'
                ));
            else $('#' + this.id + '-sample').text('');
        });

    // tag insertion
    $('.tags')
        .on('click', 'dt > a[href="#"]', function(e) {
            $(e.delegateTarget).prev().children('input')[0].value += this.text;
        });

    // hash anchor (auto tab showing)
    switch (document.location.hash) {
    case '#downloading':
    case '#waiting':
    case '#finished':
        $('[href="'+document.location.hash+'"]').tab('show');
        break;
    case '#new':
        $('#new-download').modal('show');
        $('#dl-single-url').val(bg.lastSource.link);
        $('#dl-single-referer').val(bg.lastSource.baseurl);
        bg.lastSource = {};
        break;
    case '#source':
        $('#source-download').modal('show');
        updateSourceList();
        break;
    default:
    };
    // location bar
    history.replaceState('', '', document.location.pathname);
});

async function download()
{
    const target = $('#new-download-modal-tab > [aria-selected=true]').attr('aria-controls'),
          config = await bg.config.getPref();

    switch (target) {
    case 'single':
        const targetUrl = $('#dl-single-url').val();
        // check invalid
        if (!targetUrl || $('#single').find('.is-invalid').length) return;
        // download
        bg.downloadFile(
            targetUrl,
            [{ name : 'X-DAS-Referer', value : $('#dl-single-referer').val() }],
            bg.replaceTags( // location
                bg.normalizeLocation(config['download-location'] + $('#dl-single-location').val()),
                targetUrl, null, null, null, ':name:', ':ext:'
            ),
            bg.replaceTags( // filename
                $('#dl-single-filename').val(),
                targetUrl, null, null, null, ':name:', ':ext:'
            ),
            { disableResuming    : $('#dl-single-option1').is(':checked'),
              ignoreSizemismatch : $('#dl-single-option2').is(':checked') }
        );

        // config save
        if (config['remember-new-referer']) bg.config.setPref('new-referer-value', $('#dl-single-referer').val());
        if (config['remember-new-filename']) bg.config.setPref('new-filename-value', $('#dl-single-filename').val());
        if (config['remember-new-location']) bg.config.setPref('new-location-value', $('#dl-single-location').val());
        break;

    case 'multiple':
        // check invalid
        if ($('#multiple').find('.is-invalid').length) return;
        // download
        $('#dl-multiple-url').val().split('\n').filter(v => v).forEach((url) => {
            bg.downloadFile(
                url,
                [{ name : 'X-DAS-Referer', value : $('#dl-multiple-referer').val() }],
                bg.replaceTags( // location
                    bg.normalizeLocation(config['download-location'] + $('#dl-multiple-location').val()),
                    url, null, null, null, ':name:', ':ext:'
                ),
                bg.replaceTags( // filename
                    $('#dl-multiple-filename').val(),
                    url, null, null, null, ':name:', ':ext:'
                ),
                { disableResuming    : $('#dl-single-option1').is(':checked'),
                  ignoreSizemismatch : $('#dl-single-option2').is(':checked') }
            );
        });

        // config save
        if (config['remember-new-referer']) bg.config.setPref('new-referer-value', $('#dl-multiple-referer').val());
        if (config['remember-new-filename']) bg.config.setPref('new-filename-value', $('#dl-multiple-filename').val());
        if (config['remember-new-location']) bg.config.setPref('new-location-value', $('#dl-multiple-location').val());
        break;
    }

    $('#new-download input, #new-download textarea').val('');
    $('#new-download').modal('hide');

}

async function sourceDownload()
{
    const config = await bg.config.getPref();

    // check invalid
    if ($('#source').find('.is-invalid').length) return;
    // download
    $('#source-list .source-item:not(#source-item-template) .source-url input:checked').each(function() {
        const targetUrl = this.value,
              tag = $(this).closest('.row').children('.source-tag').text(),
              title = $(this).closest('.row').children('.source-title').text() || defaultTitle;
        bg.downloadFile(
            targetUrl,
            [{ name : 'X-DAS-Referer', value : $('#dl-source-referer').val() }],
            bg.replaceTags( // location
                bg.normalizeLocation(config['download-location'] + $('#dl-source-location').val()),
                targetUrl, baseurl, tag, null, ':name:', ':ext:'
            ),
            bg.replaceTags( // filename
                $('#dl-source-filename').val(),
                targetUrl, baseurl, tag, title, ':name:', ':ext:'
            ),
            { disableResuming    : $('#dl-single-option1').is(':checked'),
              ignoreSizemismatch : $('#dl-single-option2').is(':checked') }
        );
    });

    // config save
    if (config['remember-source-tagname'])
        bg.config.setPref('source-tagname-value', $('#filter-tagnamelist').val().trim());
    if (config['remember-source-filetype']) bg.config.setPref('source-filetype-value', (() => {
        let result = [];
        $('.filter-type-checkbox:checked').each(function() { result.push(this.id.replace(/^filter-/, '')); });
        return result;
    })());
    if (config['remember-source-keyword']) {
        bg.config.setPref('source-keyword-value', $('#filter-expression').val());
        bg.config.setPref('source-regex-value', $('#filter-regex').prop('checked'));
    }
    if (config['remember-source-filename']) bg.config.setPref('source-filename-value', $('#dl-source-filename').val());
    if (config['remember-source-referer']) {
        if ($('#dl-source-referer-default').prop('checked'))
            bg.config.setPref('source-referer-default-value', true);
        else {
            bg.config.setPref('source-referer-default-value', false);
            bg.config.setPref('source-referer-value', $('#dl-source-referer').val());
        }
    }
    if (config['remember-source-location']) bg.config.setPref('source-location-value', $('#dl-source-location').val());

    $('#source-download').modal('hide');
}

function reDownload()
{
    const dlid = this.dataset.dlid;

    bg.downloadFile(
        bg.downloadQueue[dlid].originalUrl,
        bg.downloadQueue[dlid].requestHeaders,
        bg.downloadQueue[dlid].location,
        bg.downloadQueue[dlid].filename
    );

    $('#download-detail').modal('hide');
}

function stopDownload()
{
    bg.stopDownload($('#confirm-dialog').attr('data-dlid'));
}

function pauseDownload()
{
    bg.pauseDownload($('#confirm-dialog').attr('data-dlid'));
}

function resumeDownload()
{
    bg.resumeDownload(this.dataset.dlid);
}

function updateDetail(init)
{
    const dlid      = $('#download-detail').attr('data-dlid'),
          queue     = bg.downloadQueue[dlid],
          loadedObj = queue.loaded();

    // init
    if (init) {
        $('#detail-status-dlid').val(dlid);
        $('#detail-info-registered').val(new Date(queue.regTime).toLocaleString());
        $('#detail-info-url').val(queue.originalUrl);
        let referer = queue.requestHeaders.find((ele) => { return ele.name == 'X-DAS-Referer'; });
        $('#detail-info-referer').val(referer ? referer.value : '(none)');
        $('#detail-info-filename').val(() => {
            if (queue.filename) return queue.filename;
            else if (queue.responseFilename) return queue.responseFilename + ' (auto)';
            else return '';
        });
        $('#detail-info-location').val(queue.location || '(Default download directory)');
    }

    $('#download-detail').attr('data-status', queue.status);
    $('#detail-status-status').val(queue.status);
    $('#detail-status-reason').val(queue.reason);
    $('#detail-status-start').val(queue.startTime ? new Date(queue.startTime).toLocaleString() : '');
    $('#detail-status-end').val(queue.endTime ? new Date(queue.endTime).toLocaleString() : '');
    $('#detail-status-url').val(queue.responseUrl);
    if (queue.total) {
        let progress = parseInt(loadedObj.now / queue.total * 100);
        $('#detail-status-progress').css('width', progress + '%').text(progress + '%');
        $('#detail-status-total').val(queue.total.toLocaleString('en-US'));
    }
    else {
        $('#detail-status-progress').css('width', '100%').text('unknown');
        $('#detail-status-total').val('unknown');
    }
    $('#detail-status-current').val(loadedObj.now.toLocaleString('en-US'));

    // tile
    queue.detail().forEach((val, index) => {
        $('#detail-status-detail').children().eq(index).attr('data-status', val || '');
    });
}

function updateList()
{
    const $template = $('#download-item-template');

    let totalLoaded = 0;

    for (let queue of bg.downloadQueue) {
        let dlid = queue.id,
            $item;

        // total speed
        const loadedObj = queue.loaded();
        totalLoaded += parseInt(loadedObj.now / 1000);

        // listed item
        if ($('#item-' + dlid).length) {
            $item = $('#item-' + dlid);

            switch (queue.status) {
            case 'downloading':
            case 'paused':
            case 'downloaded':
                if (!$('#downloading-list').has($item).length)
                    $item.appendTo($('#downloading-list'));
                break;
            case 'waiting':
                if ($('#waiting-list').has($item).length)
                    continue;
                else
                    $item.appendTo($('#waiting-list'));
                break;
            case 'finished':
                if ($('#finished-list').has($item).length)
                    continue;
                else
                    $item.appendTo($('#finished-list'));
                break;
            case 'deleted':
                $item.remove();
                continue;
            }
        }
        // new item
        else {
            $item = $template.clone(true).attr('id', 'item-' + dlid);
            $item.find('.item-status > [data-dlid]').attr('data-dlid', dlid);

            switch (queue.status) {
            case 'downloading':
            case 'paused':
            case 'downloaded':
                $item.appendTo($('#downloading-list'));
                break;
            case 'waiting':
                $item.appendTo($('#waiting-list'));
                break;
            case 'finished':
                $item.appendTo($('#finished-list'));
                break;
            case 'deleted':
                continue;
            }
        }

        // update status
        $item.attr({
            'data-status' : queue.status,
            'data-reason' : queue.reason
        });
        $item.find('.item-filename').text(() => {
            if (queue.filename) return queue.filename;
            else if (queue.responseFilename) return queue.responseFilename;
            else return queue.originalUrl;
        });
        // progress
        if (queue.total)
            $item.find('.item-progress')
            .css('width', parseInt(loadedObj.now / queue.total*100) + '%')
            .text(calcByte(loadedObj.now) + ' / ' + calcByte(queue.total));
        else
            $item.find('.item-progress').css('width', '100%').text(calcByte(loadedObj.now) + ' / ' + 'unknown');
        // speed
        switch (queue.status) {
        case 'downloading':
            $item.find('.item-speed').text(calcByte(loadedObj.Bps) + '/s');
            $item.find('.item-remain').text(calcRemain(loadedObj, queue.total));
            break;
        case 'finished':
            $item.find('.item-speed').text(calcBps({ now : queue.loaded().now, nowTime : queue.endTime, prev : 0, prevTime : queue.startTime }));
            $item.find('.item-remain').text(parseInt((queue.endTime - queue.startTime) / 1000) + 's');
            break;
        default:
            $item.find('.item-speed').text('-');
            $item.find('.item-remain').text('-');
        }
    }

    // badge
    $('#downloading-tab > .badge').text($('#downloading-list > li.download-item:not(#download-item-template)').length);
    $('#waiting-tab > .badge').text($('#waiting-list > li.download-item:not(#download-item-template)').length);
    $('#finished-tab > .badge').text($('#finished-list > li.download-item:not(#download-item-template)').length);

    // title
    document.title = $('#downloading-tab > .badge').text() == '0' ? PAGE_TITLE : 'DL:' + $('#downloading-tab > .badge').text() + ' ' + PAGE_TITLE;

    // total speed
    const now = (new Date()).getTime();
    if (prevLoaded != null) $('#total-speed').text(calcKBps({ now : totalLoaded, nowTime : now, prev : prevLoaded, prevTime : prevLoadedTime }));
    prevLoaded     = totalLoaded;
    prevLoadedTime = now;


    function calcByte(byte)
    {
        if (byte < 1024) return byte.toFixed(1) + ' B';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + ' KB';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + ' MB';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + ' GB';
        byte /= 1024;
        return byte.toFixed(1) + ' TB';
    }
    function calcBps(loadedObj)
    {
        const term = loadedObj.nowTime - loadedObj.prevTime,
              Bps  = (loadedObj.now - loadedObj.prev) / term * 1000;
        return calcByte(Bps) + '/s';
    }
    function calcKBps(loadedObj)
    {
        const term = loadedObj.nowTime - loadedObj.prevTime,
              Bps  = (loadedObj.now - loadedObj.prev) / term * 1000;
        return calcByte(Bps * 1024) + '/s';
    }
    function calcRemain(loadedObj, total)
    {
        if (!loadedObj.now || !total) return 'unknown';

        const remain = (total - loadedObj.now) / loadedObj.Bps;

        // too long (over 30 days)
        if (remain > 86400 * 30) return 'stalled';

        return Math.floor(remain) + ' s';
    }
}

function updateSourceList()
{
    const list = bg.lastSource.list;
    baseurl = bg.lastSource.baseurl;

    // data
    for (let url of Object.keys (list)) {
        if (!allowProtocol.test(list[url].protocol)) continue;
        for (let i=0; i<list[url].tag.length; i++)
            source.push(Object.assign({}, list[url],
                                      { tag  : list[url].tag[i],
                                        title : list[url].title[i] }));
    }

    bg.lastSource = {};
}

function outputSourceList()
{
    const $template = $('#source-item-template');
    // run all filter
    const list = sortSourceList(
        filterDuplicateSourceList(
            filterSourceList(
                filterTypeSourceList(
                    filterTagnameSourceList()))));

    // all checkbox uncheck
    $('#source-all').prop('checked', false);
    $('#source-download-button1, #source-download-button2').attr('data-count', 0);
    // clear list
    $('#source-list > .source-item:not(#source-item-template)').remove();

    // html
    for (let i in list) {
        let $item = $template.clone().removeAttr('id');

        // checkbox id & attr
        $item.attr('data-filetype', list[i].filetype).find('.source-url input')
            .attr({ id : 'source' + i, value : list[i].url });
        // label for & text
        $item.find('.source-url label').attr('for', 'source' + i).text(list[i].url);
        // extension
        $item.find('.source-type').text(list[i].filetype);
        // tag
        $item.find('.source-tag').text(list[i].tag);
        // title
        $item.find('.source-title').text(list[i].title).attr('title', list[i].title);

        $item.appendTo($('#source-list'));
    }
}

function sortSourceList(filteredSource)
{
    const list = filteredSource != null ? filteredSource : Array.from(source),
          $sort = $('#sort-url, #sort-filetype, #sort-tag').filter('[data-order!=""]');

    if ($sort.length) {
        let sortkey = $sort[0].id.replace(/^sort-/, ''),
            order = $sort.attr('data-order');

        list.sort((a, b) => {
            if (a[sortkey] < b[sortkey]) return -1 * (order == 'asc' ? 1 : -1);
            if (a[sortkey] > b[sortkey]) return 1 * (order == 'asc' ? 1 : -1);
            return 0;
        });
    }

    return list;
}

function filterSourceList(filteredSource)
{
    const $filterExpression = $('#filter-expression'),
          $filterRegex = $('#filter-regex'),
          list = filteredSource != null ? filteredSource : Array.from(source),
          regexFlag = $filterRegex.prop('checked');

    var filtered;

    if (regexFlag) {
        try {
            let re = new RegExp($filterExpression.val());
            $filterExpression.toggleClass('is-invalid', false);
            filtered = list.filter((a) => { return re.test(a.url); });
        }
        catch (e) {
            // regular expression error
            $filterExpression.toggleClass('is-invalid', true);
        }
    }
    else {
        $filterExpression.toggleClass('is-invalid', false);
        filtered = list.filter((a) => { return a.url.indexOf($filterExpression.val()) !== -1; });
    }

    return filtered;
}

function filterTagnameSourceList(filteredSource)
{
    const $tagnamelist = $('#filter-tagnamelist'),
          list = filteredSource != null ? filteredSource : Array.from(source);

    var filtered;

    if ($tagnamelist.val().trim() != '') {
        if (/^[a-zA-Z|]*$/.test($tagnamelist.val().trim())) {
            try {
                let re = new RegExp('^' + $tagnamelist.val().trim() + '$');
                $tagnamelist.toggleClass('is-invalid', false);
                filtered = list.filter((a) => { return re.test(a.tag); });
            }
            catch (e) {
                // regular expression error
                $tagnamelist.toggleClass('is-invalid', true);
            }
        }
        else {
            $tagnamelist.toggleClass('is-invalid', true);
        }
    }
    else {
        $tagnamelist.toggleClass('is-invalid', false);
        filtered = list;
    }

    return filtered;
}

function filterTypeSourceList(filteredSource)
{
    const list = filteredSource != null ? filteredSource : Array.from(source);

    var filtered;

    if ($('#filter-filetype1').prop('checked') || $('#filter-filetype2').prop('checked') || $('#filter-filetype3').prop('checked')
        || $('#filter-filetype4').prop('checked') || $('#filter-filetype5').prop('checked') || $('#filter-filetype6').prop('checked')) {

        filtered = list.filter((a) => {
            if ($('#filter-filetype1').prop('checked') && filter1.test(a.filetype)) return true;
            if ($('#filter-filetype2').prop('checked') && filter2.test(a.filetype)) return true;
            if ($('#filter-filetype3').prop('checked') && filter3.test(a.filetype)) return true;
            if ($('#filter-filetype4').prop('checked') && filter4.test(a.filetype)) return true;
            if ($('#filter-filetype5').prop('checked') && filter5.test(a.filetype)) return true;
            if ($('#filter-filetype6').prop('checked') && filter6.test(a.filetype)) return true;
            return false;
        });
    }
    else
        filtered = list;

    return filtered;
}

function filterDuplicateSourceList(filteredSource)
{
    const list = filteredSource != null ? filteredSource : Array.from(source),
          hide = $('#filter-dup').prop('checked'),
          appeared = [];

    var filtered;

    if (hide) {
        filtered = list.filter(a => {
            if (!appeared.includes(a.url)) {
                appeared.push(a.url);
                return true;
            }
            else return false;
        });
    }
    else
        filtered = list;

    return filtered;
}

function checkActiveFilter()
{
    $('button[data-target="#byTagname"]').toggleClass('disabled', $('#filter-tagnamelist').val().trim().length == 0);
    $('button[data-target="#byFiletype"]').toggleClass('disabled', $('#byFiletype input:checked').length == 0);
    $('button[data-target="#byKeyword"]').toggleClass('disabled', $('#filter-expression').val().length == 0);
}

function checkDownloadOptions()
{
    $('#dl-single-option1').is(':checked')
        ? $('#dl-single-option2').prop({ disabled : true, checked : false })
        : $('#dl-single-option2').prop({ disabled : false });
    $('#dl-multiple-option1').is(':checked')
        ? $('#dl-multiple-option2').prop({ disabled : true, checked : false })
        : $('#dl-multiple-option2').prop({ disabled : false });
    $('#dl-source-option1').is(':checked')
        ? $('#dl-source-option2').prop({ disabled : true, checked : false })
        : $('#dl-source-option2').prop({ disabled : false });
}

async function localization()
{
    const config = await bg.config.getPref();

    $('[data-string]').each(function() {
        $(this).text(browser.i18n.getMessage(this.dataset.string));
    });
    $('[data-configstring]').each(function() {
        $(this).text(config[this.dataset.configstring]);
    });
}
