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
      MAX_FILTER_CNT= 5000,
      allowProtocol = /^(https|http):/,
      // not include tags such as tag and title
      allowFilename = /^([^\\/:*?"<>|\t]|(:(Y|M|D|h|m|s|dom|refdom|name|ext|mext):))*$/,
      allowLocation = /^([^:*?"<>|\t]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|name|ext|mime|mext):))*$/,
      // include tags such as tag and title for source download
      allowFilenameS= /^([^\\/:*?"<>|\t]|(:(Y|M|D|h|m|s|dom|refdom|tag|title|name|ext|mext):))*$/,
      allowLocationS= /^([^:*?"<>|\t]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|tag|name|ext|mime|mext):))*$/,
      // not include any tags for detail modal
      allowFilenameD= /^[^\\/:*?"<>|\t]*$/,
      allowLocationD= /^[^:*?"<>|\t]*$/,
      // include some tags for detail modal (waiting only)
      allowFilenameDW= /^([^\\/:*?"<>|\t]|(:(name|ext|mext):))*$/,
      allowLocationDW= /^([^:*?"<>|\t]|(:(name|ext|mime|mext):))*$/,
      denyFilename  = /^[. ]+|[. ]+$/,
      denyLocation  = /^[. ]+|\/[. ]+|[. ]+\/|^\/|(\.\/|\.\.\/|\/\/)/,
      // referer tag pattern
      refTagFilename= /:refdom:/,
      refTagLocation= /:refdom:|:refpath:/,
      defaultTitle  = 'no-title';

// valuables
let source     = [],
    prevLoadedKB = null, prevLoadedTime = null,
    filter1, filter2, filter3, filter4, filter5, filter6,
    totalGraph;
const inherited = {
    baseurl  : null,
    filename : null
};


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    await bg.initialized();
    localization();
    applyTheme();
    createGraph();
    updateList();
    setInterval(updateList, progressInterval);
    // initial theme
    $('#theme-button').on('click', toggleTheme);
    // ad (show after 7 days from installed)
    $('#review-card').toggle(
        !bg.config.getPref('ad-review-hide')
            && ((new Date()).getTime()/1000 - bg.config.getPref('installed-time')) > 7 * 86400);
    $('#comment-card').toggle(
        !bg.config.getPref('ad-comment-hide')
            && ((new Date()).getTime()/1000 - bg.config.getPref('installed-time')) > 7 * 86400);
    $('#review-card .ad-nevershow, #comment-card .ad-nevershow').on('click', neverShowCard);
    $('#review-stars').on('click', reviewClick);
    // miscellanies events
    $('.openlink-button').on('click', function() { this.dataset.link && browser.tabs.create({ url : this.dataset.link }); });
    $('.openfile-button, .item-openfile-button').on('click', async function() { this.dataset.fxid && browser.downloads.open( parseInt(this.dataset.fxid)); });
    $('.openlocation-button, .item-openlocation-button').on('click', async function() { this.dataset.fxid && browser.downloads.show( parseInt(this.dataset.fxid)); });
    // all tooltip enabled
    $('[data-toggle=tooltip]').each(function() {
        new bootstrap.Tooltip(this, { title : browser.i18n.getMessage(this.dataset.titlestring) });
    });
    // download buttons
    $('#download-button').on('click', download);
    $('#source-download-button1, #source-download-button2').on('click', sourceDownload);
    $('#setting-button').on('click', () => { browser.tabs.create({ active : true, url : '/ui/options.html' }); });
    // finished list
    $('#finished-delete-button').on('click', deleteFinished);
    $('#completed-delete-button').on('click', deleteCompleted);
    // item
    $('.item-resume-button').on('click', resumeDownload);
    $('.item-start-button').on('click', startDownload);
    $('.item-redo-button').on('click', reDownload);
    $('.item-delete-button').on('click', deleteItem);

    // new download modal
    $('#new-download')
        .on('show.bs.modal', newDownloadModal)
        .on('shown.bs.modal', function() { $(this).find('[data-focus=true]').focus(); })
        .on('hide.bs.modal', function() { inherited.baseurl = null; blurNewDownloadInput(); });
    // in new download modal
    $('#new-download input:not([type]), #new-download input[type=password]')
        .on('keypress', keypressNewDownloadInput)
        .on('focus', focusNewDownloadInput)
        .on('blur', blurNewDownloadInput);
    $('#dl-single-referer-default')
        .on('input', function() {
            if (this.checked)
                $('#dl-single-referer').val(inherited.baseurl).prop('readonly', true).removeClass('is-invalid').trigger('input');
            else
                $('#dl-single-referer').val('').prop('readonly', false).trigger('input');
        });
    // detail modal
    $('#download-detail')
        .on('show.bs.modal', detailModal)
        .on('hidden.bs.modal', detailModalHidden);
    // in detail modal
    $('#detail-resume-button').on('click', resumeDownload);
    $('#detail-start-button').on('click', startDownload);
    $('#detail-redo-button').on('click', reDownload);
    $('#detail-redo-button-manual').on('click', reDownloadManual);
    $('#detail-next-button, #detail-prev-button').on('click', switchDetail);
    $('#detail-status-detail').append(detailTile);
    $('#detail-info-filename-edit, #detail-info-location-edit')
        .on('click', function() {
            $(this).parent().prev().attr('data-editing', 'true');
            $(this).parent().prev().children().eq(0).prop('readonly', false).addClass('form-control').removeClass('form-control-plaintext').focus();
        });
    $('#detail-info-filename-apply')
        .on('click', function() {
            const dlid = $('#download-detail').attr('data-dlid'),
                  $div = $(this).parent().prev(),
                  $input = $div.children().eq(0),
                  queue = bg.downloadQueue[dlid];
            if ($input.hasClass('is-invalid')) return;

            // download finished
            if (!/waiting|downloading|paused/.test(queue.status)) return;

            queue.filename = $input.val();
            if ($input.val() == '') $input.val(queue.responseFilename);
            $div.attr('data-editing', '');
            $input.prop('readonly', true).addClass('form-control-plaintext').removeClass('form-control');
        });
    $('#detail-info-location-apply')
        .on('click', function() {
            const dlid = $('#download-detail').attr('data-dlid'),
                  $div = $(this).parent().prev(),
                  $input = $div.children().eq(0),
                  queue = bg.downloadQueue[dlid];
            if ($input.hasClass('is-invalid')) return;

            // download finished
            if (!/waiting|downloading|paused/.test(queue.status)) return;

            let location = bg.normalizeLocation($input.val());
            queue.location = $input.val(location).val();
            $div.attr('data-editing', '');
            $input.prop('readonly', true).addClass('form-control-plaintext').removeClass('form-control');
        });
    // filename validation
    $('#detail-info-filename')
        .on('input', function() {
            const allowPattern = $(this).closest('#download-detail').is('[data-status=waiting]')
                  ? allowFilenameDW : allowFilenameD;
            const valid = allowPattern.test(this.value) && !denyFilename.test(this.value);
            $(this).toggleClass('is-invalid', !valid);
        });
    // location validation
    $('#detail-info-location')
        .on('input', function() {
            const allowPattern = $(this).closest('#download-detail').is('[data-status=waiting]')
                  ? allowLocationDW : allowLocationD;
            const location = bg.normalizeLocation(this.value);
            const valid = allowPattern.test(location) && !denyLocation.test(location);
            $(this).toggleClass('is-invalid', !valid);
        });

    // confirm dialog
    $('#confirm-dialog')
        .on('show.bs.modal', confirmDialog)
        .on('shown.bs.modal', function() { $(this).find('[data-focus=true]').focus(); });

    // confirm dialog (restore)
    $('#confirm-dialog-restore')
        .on('shown.bs.modal', function() { $(this).find('[data-focus=true]').focus(); });
    $('#confirm-dialog-restore .modal-action-button').on('click', function() { bg.checkWaiting(); bg.queueRestored = false; });
    $('#confirm-dialog-restore .btn-warning').on('click', function() { stopWaiting(); bg.queueRestored = false; });
    if (bg.queueRestored) $('#confirm-dialog-restore').modal('show');

    // url validation
    $('#dl-single-url, #dl-m3u8-url')
        .on('input', validateUrl);
    // bulk url validation
    $('#dl-multiple-bulk-url')
        .on('input', validateBulkUrl);
    $('#dl-multiple-bulk-button')
        .on('click', addBulkUrl2List);
    // urls validation
    $('#dl-multiple-url')
        .on('input', validateUrls);
    // authentication validation
    $('#dl-single-user, #dl-single-pass')
        .on('input', () => validateAuthentication($('#dl-single-user'), $('#dl-single-pass')));
    $('#dl-multiple-user, #dl-multiple-pass')
        .on('input', () => validateAuthentication($('#dl-multiple-user'), $('#dl-multiple-pass')));
    $('#dl-m3u8-user, #dl-m3u8-pass')
        .on('input', () => validateAuthentication($('#dl-m3u8-user'), $('#dl-m3u8-pass')));
    $('#dl-source-user, #dl-source-pass')
        .on('input', () => validateAuthentication($('#dl-source-user'), $('#dl-source-pass')));
    // referer validation
    $('#dl-single-referer, #dl-multiple-referer, #dl-m3u8-referer, #dl-source-referer')
        .on('input', validateReferer);
    // filename validation
    $('#dl-single-filename, #dl-multiple-filename, #dl-m3u8-filename, #dl-source-filename')
        .on('input', validateFilename);
    // location validation
    $('#dl-single-location, #dl-multiple-location, #dl-m3u8-location, #dl-source-location')
        .on('input', validateLocation);
    // checkbox validation
    $('#dl-single-option1, #dl-multiple-option1, #dl-source-option1').on('input', checkDownloadOptions);

    // tag insertion
    $('.tags')
        .on('click', '.tag > a[href="#"]', function(e) {
            $(e.delegateTarget).siblings('input')[0].value += this.text;
            $(e.delegateTarget).siblings('input').eq(0).trigger('input');
        });

    // hash anchor (auto tab showing)
    hashRouter();
});

/**********************
  Manager UI functions
 **********************/
function neverShowCard()
{
    const cardid = $(this).closest('.card').attr('id');
    switch (cardid) {
    case 'review-card':
        bg.config.setPref('ad-review-hide', true);
        $('#review-card').fadeOut();
        break;
    case 'comment-card':
        bg.config.setPref('ad-comment-hide', true);
        $('#comment-card').fadeOut();
        break;
    }
}

function reviewClick()
{
    bg.config.setPref('ad-review-hide', true);
    $(window).on('focus', function() {
        $('#review-card').addClass('reviewed').delay(3000).fadeOut();
    });
}

function updateGraph(Bps)
{
    totalGraph.data.datasets[0].data.shift();
    totalGraph.data.datasets[0].data.push(Bps);
    totalGraph.update();
}

function updateList()
{
    applyTheme();

    const $template = $('#download-item-template');

    let totalLoadedKB = 0;

    for (let queue of bg.downloadQueue) {
        let dlid = queue.id,
            $item;

        // total speed
        const loadedObj = queue.loaded;
        totalLoadedKB += parseInt(loadedObj.now / 1000);

        // listed item
        if ($('#item-' + dlid).length) {
            $item = $('#item-' + dlid);

            switch (queue.status) {
            case 'downloading':
            case 'paused':
            case 'downloaded':
                if (!$('#downloading-list').has($item).length) {
                    $item.appendTo($('#downloading-list'));
                    // chart
                    $item[0].chart = createItemGraph($item.find('.item-speed-graph'));
                }
                break;
            case 'waiting':
                if ($('#waiting-list').has($item).length) {
                    // filename
                    $item.find('.item-filename').text(queue.autoFilename || queue.filename || queue.responseFilename || queue.originalUrlInput);
                    continue;
                }
                else
                    $item.appendTo($('#waiting-list'));
                break;
            case 'finished':
                $item.find('.item-status > [data-fxid]').attr('data-fxid', queue.fxid);
                if ($('#finished-list').has($item).length)
                    continue;
                else {
                    $item.appendTo($('#finished-list'));
                    // chart
                    $item[0].chart && $item[0].chart.destroy();
                    delete $item[0].chart;
                }
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
                // chart
                $item[0].chart = createItemGraph($item.find('.item-speed-graph'));
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
        $item.find('.item-filename').text(queue.autoFilename || queue.filename || queue.responseFilename || queue.originalUrlInput);
        // progress
        if (queue.total)
            $item.find('.item-progress')
            .css('width', parseInt(loadedObj.now / queue.total*100) + '%')
            .text(calcByte(loadedObj.now) + ' / ' + calcByte(queue.total));
        else if (queue.mode == 'm3u8' && queue.m3u8)
            $item.find('.item-progress')
            .css('width', parseInt(queue.data.filter(datum => datum.status == 'complete').length / queue.m3u8.length*100) + '%')
            .text(calcByte(loadedObj.now) + ' /  unknown' );
        else
            $item.find('.item-progress').css('width', '100%').text(calcByte(loadedObj.now) + ' / unknown');
        // speed
        switch (queue.status) {
        case 'downloading':
            $item.find('.item-speed').text(calcByte(loadedObj.Bps) + '/s');
            $item.find('.item-remain').text(calcRemain(loadedObj, queue.total));
            // chart
            setTimeout(
                () => { updateItemGraph($item[0].chart, loadedObj.Bps / 1024 / 1024); },
                100
            );
            break;
        case 'finished':
            if (queue.startTime) {
                $item.find('.item-speed').text(calcBps({ now : queue.loaded.now, nowTime : queue.endTime, prev : 0, prevTime : queue.startTime }));
                $item.find('.item-remain').text(calcElapsed((queue.endTime - queue.startTime) / 1000));
            }
            break;
        case 'paused':
        case 'downloaded':
            // chart
            setTimeout(
                () => { updateItemGraph($item[0].chart, 0); },
                100
            );
        default:
            $item.find('.item-speed').text('-');
            $item.find('.item-remain').text('-');
        }
    }

    // badge
    $('#downloading-tab > .badge').text($('#downloading-list').children().length - 1);
    $('#waiting-tab > .badge').text($('#waiting-list').children().length - 1);
    $('#finished-tab > .badge').text($('#finished-list').children().length - 1);

    // title
    document.title = $('#downloading-tab > .badge').text() == '0' ? PAGE_TITLE : 'DL:' + $('#downloading-tab > .badge').text() + ' ' + PAGE_TITLE;

    // total speed
    const now = (new Date()).getTime();
    if (prevLoadedKB > totalLoadedKB) {
        $('#total-speed').text(calcBpsKB({ now : 0, nowTime : now, prev : 0, prevTime : prevLoadedTime }));
        updateGraph(calcMBpsKB({ now : 0, nowTime : now, prev : 0, prevTime : prevLoadedTime }));
    }
    else if (prevLoadedKB != null) {
        $('#total-speed').text(calcBpsKB({ now : totalLoadedKB, nowTime : now, prev : prevLoadedKB, prevTime : prevLoadedTime }));
        updateGraph(calcMBpsKB({ now : totalLoadedKB, nowTime : now, prev : prevLoadedKB, prevTime : prevLoadedTime }));
    }
    else
        $('#total-speed').text(browser.i18n.getMessage('footer_speed_calc'));
    prevLoadedKB   = totalLoadedKB;
    prevLoadedTime = now;


    function calcByte(byte)
    {
        if (byte < 1024) return byte.toFixed(1) + 'B';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + 'KB';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + 'MB';
        byte /= 1024;
        if (byte < 1024) return byte.toFixed(1) + 'GB';
        byte /= 1024;
        return byte.toFixed(1) + 'TB';
    }
    function calcBps(loadedObj)
    {
        const term = loadedObj.nowTime - loadedObj.prevTime,
              Bps  = (loadedObj.now - loadedObj.prev) / term * 1000;
        return calcByte(Bps) + '/s';
    }
    function calcBpsKB(loadedObj)
    {
        const term = loadedObj.nowTime - loadedObj.prevTime,
              Bps  = (loadedObj.now - loadedObj.prev) / term * 1000;
        return calcByte(Bps * 1024) + '/s';
    }
    function calcMBpsKB(loadedObj)
    {
        const term = loadedObj.nowTime - loadedObj.prevTime,
              Bps  = (loadedObj.now - loadedObj.prev) / term * 1000;
        return (Bps / 1024).toFixed(1);
    }
    function calcRemain(loadedObj, total)
    {
        if (!loadedObj.now || !total || !loadedObj.Bps) return 'unknown';

        const remain = Math.floor((total - loadedObj.now) / loadedObj.Bps);

        if (remain < 60)            return remain + 's';
        else if (remain < 3600)     return Math.floor(remain/60) + 'm ' + remain%60 + 's';
        else if (remain < 86400)    return Math.floor(remain/3600) + 'h ' + Math.floor(remain%3600/60) + 'm ' + remain%3600%60 + 's';
        else if (remain < 86400*30) return Math.floor(remain/86400) + 'd ' + Math.floor(remain%86400/3600) + 'h ' + Math.floor(remain%86400%3600/60) + 'm ' + remain%86400%3600%60 + 's';
        // too long (over 30 days)
        else return 'stalled';
    }
    function calcElapsed(second)
    {
        second = Math.floor(second);
        if (second < 60)         return second + 's';
        else if (second < 3600)  return Math.floor(second/60) + 'm ' + second%60 + 's';
        else if (second < 86400) return Math.floor(second/3600) + 'h ' + Math.floor(second%3600/60) + 'm ' + second%3600%60 + 's';
        else                     return Math.floor(second/86400) + 'd ' + Math.floor(second%86400/3600) + 'h ' + Math.floor(second%86400%3600/60) + 'm ' + second%86400%3600%60 + 's';
    }
    function createItemGraph($itemSpeedGraph)
    {
        return new Chart($itemSpeedGraph[0], {
            type : 'line',
            data : {
                labels : [0,1,2,3,4,5,6,7,8,9,10],
                datasets : [{
                    data : [0,0,0,0,0,0,0,0,0,0,0],
                    tension : 0.2,
                    fill : true,
                    borderColor : '#0dcaf080',
                    backgroundColor : '#0dcaf040'
                }]
            },
            options : {
                responsive : true,
                resizeDelay : 100,
                maintainAspectRatio : false,
                elements : {
                    point : {
                        pointStyle : false
                    }
                },
                interaction : {
                    mode : 'index',
                    intersect : false
                },
                plugins : {
                    legend : { display : false },
                    tooltip : {
                        enabled : false
                    }
                },
                scales : {
                    x : {
                        display : false,
                        min : 1,
                        grid : { display : false }
                    },
                    y : {
                        display : false,
                        min : 0,
                        max : 1,
                        grid : { display : false }
                    }
                }
            }
        });
    }
    function updateItemGraph(chart, Bps)
    {
        chart.data.datasets[0].data.shift();
        chart.data.datasets[0].data.push(Bps);
        chart.update();
    }
}

function createGraph()
{
    const ctx = $('#total-speed-graph')[0];
    totalGraph = new Chart(ctx, {
        type : 'line',
        data : {
            labels : [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
            datasets : [{
                data : [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
                tension : 0.2,
                fill : true,
                borderColor : '#ffc10780',
                backgroundColor : '#ffc10740'
            }]
        },
        options : {
            responsive : true,
            resizeDelay : 100,
            maintainAspectRatio : false,
            elements : {
                point : {
                    pointStyle : false
                }
            },
            interaction : {
                mode : 'index',
                intersect : false
            },
            plugins : {
                legend : { display : false },
                tooltip : {
                    usePointStyle : true,
                    callbacks : {
                        title : () => '',
                        label : (context) => { return context.parsed.y + ' MB/s'; },
                        labelPointStyle : () => { return { pointStyle : 'line' }; }
                    }
                }
            },
            scales : {
                x : {
                    display : false,
                    min : 1,
                    grid : { display : false }
                },
                y : {
                    display : false,
                    min : 0,
                    grid : { display : false },
                    beforeCalculateLabelRotation : (axis) => {
                        // change all itemGraph range
                        $('#downloading-list > .download-item').each((i, e) => {
                            if (e.chart) e.chart.options.scales.y.max = axis._valueRange;
                        });
                    }
                }
            }
        }
    });
}

function hashRouter()
{
    const hash = document.location.hash;

    switch (hash) {
    case '#downloading':
    case '#waiting':
    case '#finished':
        $('[href="'+hash+'"]').tab('show');
        break;
    case '#new':
        inherited.baseurl = bg.lastSource.baseurl;
        $('#new-download').on('shown.bs.modal', setParameters);
        $('#new-download').modal('show');

        function setParameters() {
            $('#new-download').off('shown.bs.modal', setParameters);
            const config = bg.config.getPref();

            $('#dl-single-url').val(bg.lastSource.link);
            // default-referer
            if (!config['remember-new-referer'] || config['remember-new-referer'] && config['new-referer-default-value'])
                $('#dl-single-referer-default').prop('checked', true).trigger('input');
            else if (config['remember-new-referer']) {
                $('#dl-single-referer-default').prop('checked', false);
                $('#dl-single-referer').val(config['new-referer-value']);
            }
            bg.lastSource = {};

            // automatically download
            if (config['contextmenu-auto-download-link']) download();
        }
        break;
    case '#select':
    case '#source':
        inherited.baseurl  = bg.lastSource.baseurl;
        inherited.filename = bg.lastSource.filename;
        updateSourceList();
        bg.lastSource = {};

        // source download modal
        $('#source-download')
            .on('show.bs.modal', sourceDownloadModal)
            .on('hidden.bs.modal', sourceDownloadModalHidden);

        $('#source-download').on('shown.bs.modal', setParametersSource);
        $('#source-download').modal('show');

        async function setParametersSource() {
            const config = bg.config.getPref();

            if (inherited.filename) {
                $('#dl-source-filename').val(
                    inherited.filename
                        + (config['contextmenu-add-ext-filename'] ? ':ext:' : '')
                        + (config['contextmenu-add-mext-filename'] ? ':mext:' : '')
                ).trigger('input');
                if (config['contextmenu-open-options-filename']) $('#source-download-option').show();
            }

            // automatically download
            switch (hash) {
            case '#select':
                if (config['contextmenu-auto-download-allselect']) {
                    await outputSourceList();
                    $('#source-all').prop('checked', true);
                    await changeSourceAll.apply($('#source-all')[0]);
                    sourceDownload();
                }
                else if (config['contextmenu-auto-download-oneselect']) {
                    const count = await outputSourceList();
                    if (count == 1) {
                        $('#source-all').prop('checked', true);
                        await changeSourceAll.apply($('#source-all')[0]);
                        sourceDownload();
                        showAutoHideToast(browser.i18n.getMessage('toast_auto_download_oneselect'));
                    }
                }
                else outputSourceList();
                break;
            case '#source':
                if (config['contextmenu-auto-download-allurl']) {
                    await outputSourceList();
                    $('#source-all').prop('checked', true);
                    await changeSourceAll.apply($('#source-all')[0]);
                    sourceDownload();
                }
                else if (config['contextmenu-auto-download-oneurl']) {
                    const count = await outputSourceList();
                    if (count == 1) {
                        $('#source-all').prop('checked', true);
                        await changeSourceAll.apply($('#source-all')[0]);
                        sourceDownload();
                        showAutoHideToast(browser.i18n.getMessage('toast_auto_download_oneurl'));
                    }
                }
                else outputSourceList();
                break;
            }
        }
        break;
    default:
    };

    // location bar
    history.replaceState('', '', document.location.pathname);
}

function localization()
{
    const config = bg.config.getPref();

    $('[data-string]').each(function() {
        $(this).text(browser.i18n.getMessage(this.dataset.string));
    });
    $('[data-string-placeholder]').each(function() {
        $(this).attr('placeholder', browser.i18n.getMessage(this.dataset.stringPlaceholder));
    });
    $('[data-configstring]').each(function() {
        $(this).text(config[this.dataset.configstring]);
    });
}

function applyTheme(t)
{
    const theme = t || bg.config.getPref('theme');
    $('#theme-button').attr('data-theme', theme);
    if (theme == 'auto')
        $('html').attr('data-bs-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    else
        $('html').attr('data-bs-theme', theme);
}

function toggleTheme()
{
    const now = $('#theme-button').attr('data-theme');
    let next;
    switch (now) {
    case 'auto':
        next = 'dark';
        break;
    case 'dark':
        next = 'light';
        break;
    case 'light':
        next = 'auto';
        break;
    }
    bg.config.setPref('theme', next);
    // apply immediatelly
    applyTheme(next);
}

/********************
  Download functions
 ********************/
function download()
{
    const target = $('#new-download-modal-tab > [aria-selected=true]').attr('aria-controls'),
          config = bg.config.getPref();

    switch (target) {
    case 'single':
        const targetUrl = $('#dl-single-url').val();
        // check invalid
        if (!targetUrl || $('#single').find('.is-invalid').length) return;
        // download
        bg.downloadFile(
            targetUrl,
            [{ name : 'X-DAS-Referer', value : $('#dl-single-referer').val() }],
            { location :
              bg.replaceTags({ // location
                  path       : bg.normalizeLocation(config['download-location'] + $('#dl-single-location').val()),
                  targetUrl  : targetUrl,
                  refererUrl : $('#dl-single-referer').val()
              }),
              originalLocation : $('#dl-single-location').val() },
            { filename :
              bg.replaceTags({ // filename
                  path       : $('#dl-single-filename').val(),
                  targetUrl  : targetUrl,
                  refererUrl : $('#dl-single-referer').val()
              }, true),
              originalFilename : $('#dl-single-filename').val() },
            { authentication      : [ $('#dl-single-user').val(), $('#dl-single-pass').val() ],
              disableResuming    : $('#dl-single-option1').is(':checked'),
              ignoreSizemismatch : $('#dl-single-option2').is(':checked') }
        );

        // config save
        if (config['remember-new-referer']) {
            if ($('#dl-single-referer-default').prop('checked'))
                bg.config.setPref('new-referer-default-value', true);
            else {
                bg.config.setPref('new-referer-default-value', false);
                bg.config.setPref('new-referer-value', $('#dl-single-referer').val());
            }
        }
        if (config['remember-new-filename']) bg.config.setPref('new-filename-value', $('#dl-single-filename').val());
        if (config['remember-new-location']) bg.config.setPref('new-location-value', $('#dl-single-location').val());
        if (config['remember-new-option1']) bg.config.setPref('new-option1-value', $('#dl-single-option1').prop('checked'));
        if (config['remember-new-option2']) bg.config.setPref('new-option2-value', $('#dl-single-option2').prop('checked'));
        break;

    case 'multiple':
        // check invalid
        if ($('#multiple').find('.is-invalid').length) return;
        // download
        $('#dl-multiple-url').val().split('\n').filter(v => v).forEach((url) => {
            bg.downloadFile(
                url,
                [{ name : 'X-DAS-Referer', value : $('#dl-multiple-referer').val() }],
                { location :
                  bg.replaceTags({ // location
                      path       : bg.normalizeLocation(config['download-location'] + $('#dl-multiple-location').val()),
                      targetUrl  : url,
                      refererUrl : $('#dl-multiple-referer').val()
                  }),
                  originalLocation : $('#dl-multiple-location').val() },
                { filename :
                  bg.replaceTags({ // filename
                      path      : $('#dl-multiple-filename').val(),
                      targetUrl : url,
                      refererUrl : $('#dl-multiple-referer').val()
                  }, true),
                  originalFilename : $('#dl-multiple-filename').val() },
                { authentication      : [ $('#dl-multiple-user').val(), $('#dl-multiple-pass').val() ],
                  disableResuming    : $('#dl-multiple-option1').is(':checked'),
                  ignoreSizemismatch : $('#dl-multiple-option2').is(':checked') }
            );
        });

        // config save
        if (config['remember-new-referer']) bg.config.setPref('new-referer-value', $('#dl-multiple-referer').val());
        if (config['remember-new-filename']) bg.config.setPref('new-filename-value', $('#dl-multiple-filename').val());
        if (config['remember-new-location']) bg.config.setPref('new-location-value', $('#dl-multiple-location').val());
        if (config['remember-new-option1']) bg.config.setPref('new-option1-value', $('#dl-multiple-option1').prop('checked'));
        if (config['remember-new-option2']) bg.config.setPref('new-option2-value', $('#dl-multiple-option2').prop('checked'));
        break;

    case 'm3u8':
        const m3u8Url = $('#dl-m3u8-url').val();
        // check invalid
        if (!m3u8Url || $('#m3u8').find('.is-invalid').length) return;
        // download
        bg.downloadFile(
            m3u8Url,
            [{ name : 'X-DAS-Referer', value : $('#dl-m3u8-referer').val() }],
            { location :
              bg.replaceTags({ // location
                  path       : bg.normalizeLocation(config['download-location'] + $('#dl-m3u8-location').val()),
                  targetUrl  : m3u8Url,
                  refererUrl : $('#dl-m3u8-referer').val()
              }),
              originalLocation : $('#dl-m3u8-location').val() },
            { filename :
              bg.replaceTags({ // filename
                  path       : $('#dl-m3u8-filename').val(),
                  targetUrl  : m3u8Url,
                  refererUrl : $('#dl-m3u8-referer').val()
              }, true),
              originalFilename : $('#dl-m3u8-filename').val() },
            { authentication : [ $('#dl-m3u8-user').val(), $('#dl-m3u8-pass').val() ],
              mode           : 'm3u8' }
        );

        // config save
        if (config['remember-new-referer']) {
            if ($('#dl-m3u8-referer-default').prop('checked'))
                bg.config.setPref('new-referer-default-value', true);
            else {
                bg.config.setPref('new-referer-default-value', false);
                bg.config.setPref('new-referer-value', $('#dl-m3u8-referer').val());
            }
        }
        if (config['remember-new-filename']) bg.config.setPref('new-filename-value', $('#dl-m3u8-filename').val());
        if (config['remember-new-location']) bg.config.setPref('new-location-value', $('#dl-m3u8-location').val());
        break;
    }

    $('#new-download input, #new-download textarea').val('');
    $('#new-download').modal('hide');

}

function sourceDownload()
{
    const config = bg.config.getPref();

    // check invalid
    if ($('#source').find('.is-invalid').length) return;
    // download
    $('#source-list .source-item .source-url input:checked').each(function() {
        const targetUrl = this.value,
              tag = $(this).closest('.row').children('.source-tag').text(),
              title = $(this).closest('.row').children('.source-title').text() || defaultTitle;
        bg.downloadFile(
            targetUrl,
            [{ name : 'X-DAS-Referer', value : $('#dl-source-referer').val() }],
            { location :
              bg.replaceTags({ // location
                  path       : bg.normalizeLocation(config['download-location'] + $('#dl-source-location').val()),
                  targetUrl  : targetUrl,
                  refererUrl : inherited.baseurl,
                  tag        : tag
              }),
              originalLocation : $('#dl-source-location').val() },
            { filename :
              bg.replaceTags({ // filename
                  path       : $('#dl-source-filename').val(),
                  targetUrl  : targetUrl,
                  refererUrl : inherited.baseurl,
                  tag        : tag,
                  title      : title
              }, true),
              originalFilename : $('#dl-source-filename').val() },
            { authentication      : [ $('#dl-source-user').val(), $('#dl-source-pass').val() ],
              disableResuming    : $('#dl-source-option1').is(':checked'),
              ignoreSizemismatch : $('#dl-source-option2').is(':checked') }
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
    if (config['remember-source-referer']) {
        if ($('#dl-source-referer-default').prop('checked'))
            bg.config.setPref('source-referer-default-value', true);
        else {
            bg.config.setPref('source-referer-default-value', false);
            bg.config.setPref('source-referer-value', $('#dl-source-referer').val());
        }
    }
    if (config['remember-source-filename']) bg.config.setPref('source-filename-value', $('#dl-source-filename').val());
    if (config['remember-source-location']) bg.config.setPref('source-location-value', $('#dl-source-location').val());
    if (config['remember-source-option1']) bg.config.setPref('source-option1-value', $('#dl-source-option1').prop('checked'));
    if (config['remember-source-option2']) bg.config.setPref('source-option2-value', $('#dl-source-option2').prop('checked'));

    $('#source-download').modal('hide');
}

/****************************
  Re download item functions
 ****************************/
function reDownload()
{
    const dlid  = this.dataset.dlid,
          queue = bg.downloadQueue[dlid];

    bg.downloadFile(
        queue.originalUrlInput,
        queue.requestHeaders,
        { location         : queue.location,
          originalLocation : queue.originalLocation },
        { filename         : queue.filename,
          originalFilename : queue.originalFilename },
        queue.option
    );

    $('#download-detail').modal('hide');
}

function reDownloadManual()
{
    const dlid  = this.dataset.dlid,
          queue = bg.downloadQueue[dlid];

    $('#download-detail').modal('hide');
    if (queue.mode == 'm3u8')
        $('#new-download').on('shown.bs.modal', setParameters_m3u8);
    else
        $('#new-download').on('shown.bs.modal', setParameters);
    $('#new-download').modal('show');

    function setParameters()
    {
        $('#single-tab').tab('show');
        $('#dl-single-url').val(queue.originalUrlInput);
        $('#dl-single-user').val(queue.option.authentication[0]);
        $('#dl-single-pass').val(queue.option.authentication[1]);
        if (queue.option.authentication[0]) $('#dl-single-authentication').collapse('show');
        const referer = queue.requestHeaders.find((ele) => { return ele.name == 'X-DAS-Referer'; });
        $('#dl-single-referer').val(referer.value).trigger('input');
        $('#dl-single-location').val(queue.originalLocation).trigger('input');
        $('#dl-single-filename').val(queue.originalFilename).trigger('input');
        $('#dl-single-option1').prop('checked', queue.option.disableResuming).trigger('input');
        $('#dl-single-option2').prop('checked', queue.option.ignoreSizemismatch).trigger('input');

        $('#new-download').off('shown.bs.modal', setParameters);
    }
    function setParameters_m3u8()
    {
        $('#m3u8-tab').tab('show');
        $('#dl-m3u8-url').val(queue.originalUrlInput);
        $('#dl-m3u8-user').val(queue.option.authentication[0]);
        $('#dl-m3u8-pass').val(queue.option.authentication[1]);
        if (queue.option.authentication[0]) $('#dl-m3u8-authentication').collapse('show');
        const referer = queue.requestHeaders.find((ele) => { return ele.name == 'X-DAS-Referer'; });
        $('#dl-m3u8-referer').val(referer.value).trigger('input');
        $('#dl-m3u8-location').val(queue.originalLocation).trigger('input');
        $('#dl-m3u8-filename').val(queue.originalFilename).trigger('input');

        $('#new-download').off('shown.bs.modal', setParameters);
    }
}

/**************************
  Item operation functions
 **************************/
function deleteFinished()
{
    bg.searchQueue({ status : 'finished' }).forEach((queue) => {
        bg.deleteQueue(queue.id);
        $('#item-' + queue.id).remove();
    });
}

function deleteCompleted()
{
    bg.searchQueue({ status : 'finished' , reason : 'complete' }).forEach((queue) => {
        bg.deleteQueue(queue.id);
        $('#item-' + queue.id).remove();
    });
}

function deleteItem()
{
    bg.deleteQueue(this.dataset.dlid);
    $('#item-' + this.dataset.dlid).remove();
}

function stopDownload()
{
    bg.stopDownload($('#confirm-dialog').attr('data-dlid'));
}

function pauseDownload()
{
    bg.pauseDownload($('#confirm-dialog').attr('data-dlid'));
}

function stopDownloading()
{
    bg.searchQueue({ status : 'downloading' }).concat(
        bg.searchQueue({ status : 'paused' }),
        bg.searchQueue({ status : 'downloaded' })
    )
        .forEach((queue) => {
            bg.stopDownload(queue.id);
            $('#item-' + queue.id).remove();
        });
}

function stopWaiting()
{
    bg.searchQueue({ status : 'waiting' }).forEach((queue) => {
        bg.stopDownload(queue.id);
        $('#item-' + queue.id).remove();
    });
}

function resumeDownload()
{
    bg.resumeDownload(this.dataset.dlid);
}

function startDownload()
{
    bg.startDownload(this.dataset.dlid);
}

/*************************
  Modal opening functions
 ************************/
function newDownloadModal()
{
    if (!inherited.baseurl) {
        // initial url
        $('#dl-single-url, #dl-multiple-bulk-url, #dl-multiple-url, #dl-m3u8-url').val('').trigger('input');
        // default-referer from new button
        $('#dl-single-referer-default').prop('checked', false).trigger('input');
        $('#dl-single-referer-default-group').css('display', 'none');
    }

    // initial value
    const config = bg.config.getPref();
    // initial authentication
    $('#dl-single-user, #dl-multiple-user, #dl-m3u8-user, #dl-single-pass, #dl-multiple-pass, #dl-m3u8-pass').val('');
    // initial filename
    $('#dl-single-filename, #dl-multiple-filename, #dl-m3u8-filename').val(config['remember-new-filename'] ? config['new-filename-value'] : '');
    // initial location
    $('#dl-single-location, #dl-multiple-location, #dl-m3u8-location').val(config['remember-new-location'] ? config['new-location-value'] : '');
    // initial referer
    $('#dl-single-referer, #dl-multiple-referer, #dl-m3u8-referer').val(config['remember-new-referer'] ? config['new-referer-value'] : '').trigger('input');
    // initial option1
    $('#dl-single-option1, #dl-multiple-option1').prop('checked', config['remember-new-option1'] ? config['new-option1-value'] : false).trigger('input');
    // initial option2
    $('#dl-single-option2, #dl-multiple-option2').prop('checked', config['remember-new-option2'] ? config['new-option2-value'] : false).trigger('input');
}

function sourceDownloadModal()
{
    $('#source-download input:not([type]), #source-download input[type=password]')
        .on('keypress', keypressSourceInput)
        .on('focus', focusSourceInput)
        .on('blur', blurSourceInput);
    $('#source-all')
        .on('keypress', keypressSourceInput)
        .on('focus', focusSourceInput)
        .on('blur', blurSourceInput)
        .on('change', changeSourceAll);
    // source list item
    $('#source-list')
        .on('keypress', '.source-url-input', keypressSourceInput)
        .on('focus', '.source-url-input', focusSourceInput)
        .on('blur', '.source-url-input', blurSourceInput)
        .on('change', '.source-url-input', changeSourceItem)
        .on('click', '.source-item', checkSourceItem)
        .on('mousedown', '.source-item', (e) => {
            if (e. originalEvent.shiftKey) return false;
            else return true;
        });
    // source list sort
    $('#sort-url, #sort-filetype, #sort-tag').on('click', sortSourceItems);
    // source list filter
    $('#byTagname input, #byFiletype input, #byKeyword input')
        .on('input', function() { if (source.length < MAX_FILTER_CNT) { checkActiveFilter(); outputSourceList(); } });
    // hide duclication
    $('#filter-dup')
        .on('input', function() { checkActiveFilter(); outputSourceList(); });
    // source list filter button
    $('#filter-tagnamelist-button, #filter-type-button, #filter-expression-button')
        .on('click', function() { checkActiveFilter(); outputSourceList(); });

    // filter button
    if (source.length >= MAX_FILTER_CNT) {
        $('#filter-tagnamelist-button, #filter-type-button, #filter-expression-button')
            .parent().removeClass('d-none');
    }

    // default-referer
    $('#dl-source-referer-default').on('input', function() {
        if (this.checked)
            $('#dl-source-referer').val(inherited.baseurl).prop('readonly', true).removeClass('is-invalid').trigger('input');
        else
            $('#dl-source-referer').val('').prop('readonly', false).trigger('input');
    });
    // initial value
    const config = bg.config.getPref();
    // filter-filetypes
    filter1 = new RegExp('^(' + config['filetype1-extension'] + ')$'),
    filter2 = new RegExp('^(' + config['filetype2-extension'] + ')$'),
    filter3 = new RegExp('^(' + config['filetype3-extension'] + ')$'),
    filter4 = new RegExp('^(' + config['filetype4-extension'] + ')$'),
    filter5 = new RegExp('^(' + config['filetype5-extension'] + ')$'),
    filter6 = new RegExp('^(' + config['filetype6-extension'] + ')$');
    // initial source-tagname (checked by checkActiveFilter)
    if (config['remember-source-tagname'])
        $('#filter-tagnamelist').val(config['source-tagname-value']);
    // initial source-filetype (checked by checkActiveFilter)
    if (config['remember-source-filetype'])
        config['source-filetype-value'].forEach((type) => { $('#filter-' + type).prop('checked', true); });
    // initial source-keyword (checked by checkActiveFilter)
    if (config['remember-source-keyword']) {
        $('#filter-expression').val(config['source-keyword-value']);
        $('#filter-regex').prop('checked', config['source-regex-value']);
    }
    // initial source-authentication
    $('#dl-source-user, #dl-source-pass').val('');
    // initial source-referer
    if (!config['remember-source-referer'] || config['remember-source-referer'] && config['source-referer-default-value'])
        $('#dl-source-referer-default').prop('checked', true).trigger('input');
    else if (config['remember-source-referer']) {
        $('#dl-source-referer-default').prop('checked', false);
        $('#dl-source-referer').val(config['source-referer-value']);
    }
    // initial source-filename
    $('#dl-source-filename').val(config['remember-source-filename'] ? config['source-filename-value'] : '').trigger('input');
    // initial source-location
    $('#dl-source-location').val(config['remember-source-location'] ? config['source-location-value'] : '').trigger('input');
    // initial option1
    $('#dl-source-option1').prop('checked', config['remember-source-option1'] ? config['source-option1-value'] : false).trigger('input');
    // initial option2
    $('#dl-source-option2').prop('checked', config['remember-source-option2'] ? config['source-option2-value'] : false).trigger('input');
    // tab color
    checkActiveFilter();
}

function sourceDownloadModalHidden()
{
    inherited.baseurl = null;
    $(this).remove();
    blurSourceInput();
}

function detailModal(e)
{
    const button = e.relatedTarget;
    // update dlid
    $('#download-detail, #download-detail [data-dlid]').attr('data-dlid', button.dataset.dlid);
    // update detail
    updateDetail(true);
    $(this).attr('data-timer', setInterval(updateDetail, progressInterval));
}

function detailModalHidden()
{
    // to stop animation
    $(this).attr('data-status', '');
    clearInterval($(this).attr('data-timer'));
}

/**********************
  Validation functions
 **********************/
function validateAuthentication($user, $pass)
{
    $user.toggleClass('is-invalid', $user.val() == '' && $pass.val() != '');
}

function validateUrl()
{
    if (!this.value) {
        $(this).toggleClass('is-invalid', false);
        return;
    }
    try {
        new URL(this.value);
        $(this).toggleClass('is-invalid', !allowProtocol.test(this.value));
    }
    catch (e) {
        $(this).toggleClass('is-invalid', true);
    }
}

function validateBulkUrl()
{
    const $sample = $('#' + this.id + '-sample').text('');
    const $sample1 = $('#' + this.id + '-sample1').text('');
    const $sample2 = $('#' + this.id + '-sample2').text('');
    const $sample3 = $('#' + this.id + '-sample3').text('');

    if (!this.value) {
        $(this).toggleClass('is-invalid', false);
        return;
    }

    let result;
    // brace expansion
    try {
        result = braceExpansion(this.value);
    }
    catch (e) {
        $(this).toggleClass('is-invalid', true);
        $sample.text(e.message);
        return;
    }
    // url check
    try {
        new URL(result[0]);
        $(this).toggleClass('is-invalid', !allowProtocol.test(result[0]));
    }
    catch (e) {
        $(this).toggleClass('is-invalid', true);
        $sample.text(e.message);
        return;
    }

    // sample
    result[0] && $sample1.text(result[0]);
    result[1] && $sample2.text(result[1]);
    result[2] && $sample3.text(result[2]);
}

function validateUrls()
{
    if (!this.value) {
        $(this).toggleClass('is-invalid', false);
        return;
    }
    try {
        ($(this).val().split('\n')).forEach((line) => {
            new URL(line);
            $(this).toggleClass('is-invalid', !allowProtocol.test(line));
        });
    }
    catch (e) {
        $(this).toggleClass('is-invalid', true);
    }
}

function validateReferer()
{
    const $filename = $('#' + this.id.replace('referer', 'filename')),
          $location = $('#' + this.id.replace('referer', 'location'));

    // empty referer
    if (!this.value) {
        $(this).toggleClass('is-invalid', false);
        $filename.trigger('input'), $location.trigger('input');
        return;
    }
    try {
        new URL(this.value);
        $(this).toggleClass('is-invalid', !allowProtocol.test(this.value));
        $filename.trigger('input'), $location.trigger('input');
    }
    catch (e) {
        $(this).toggleClass('is-invalid', true);
        $filename.trigger('input'), $location.trigger('input');
    }
}

function validateFilename()
{
    const $referer     = $('#' + this.id.replace('filename', 'referer')),
          $location    = $('#' + this.id.replace('filename', 'location')),
          allowPattern = this.id != 'dl-source-filename' ? allowFilename : allowFilenameS,
          valid        =
          refTagFilename.test(this.value) && $referer.val() && !$referer.hasClass('is-invalid')
          || !refTagFilename.test(this.value)
          && allowPattern.test(this.value) && !denyFilename.test(this.value);

    // referer validation
    refTagFilename.test(this.value) && !$referer.val() && $referer.toggleClass('is-invalid', true);
    !refTagFilename.test(this.value) && !refTagLocation.test($location.val()) && !$referer.val() && $referer.toggleClass('is-invalid', false);

    $(this).toggleClass('is-invalid', !valid);
    // sample
    if (valid) $('#' + this.id + '-sample').text(
        bg.replaceTags({
            path       : this.value,
            targetUrl  : 'http://www.example.com/path/name/',
            refererUrl : $referer.val(),
            tag        : 'tag',
            title      : 'title',
            name       : 'filename',
            ext        : 'ext',
            mime       : 'sample/mime-type'
        }, true));
    else $('#' + this.id + '-sample').text('');
}

function validateLocation()
{
    const defaultLocation = bg.config.getPref('download-location'),
          location        = bg.normalizeLocation(defaultLocation + this.value),
          $referer        = $('#' + this.id.replace('location', 'referer')),
          $filename       = $('#' + this.id.replace('location', 'filename')),
          allowPattern    = this.id != 'dl-source-location' ? allowLocation : allowLocationS,
          valid           =
          refTagLocation.test(this.value) && $referer.val() && !$referer.hasClass('is-invalid')
          || !refTagLocation.test(this.value)
          && allowPattern.test(location) && !denyLocation.test(location);

    // referer validation
    refTagLocation.test(this.value) && !$referer.val() && $referer.toggleClass('is-invalid', true);
    !refTagLocation.test(this.value) && !refTagFilename.test($filename.val()) && !$referer.val() && $referer.toggleClass('is-invalid', false);

    $(this).toggleClass('is-invalid', !valid);
    // sample
    if (valid) $('#' + this.id + '-sample').text(
        bg.replaceTags({
            path       : location,
            targetUrl  : 'http://www.example.com/path/name/',
            refererUrl : $referer.val(),
            tag        : 'tag',
            title      : 'title',
            name       : 'filename',
            ext        : 'ext',
            mime       : 'sample/mime-type'
        }));
    else $('#' + this.id + '-sample').text('');
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

/******************************
  New download modal functions
 ******************************/
function keypressNewDownloadInput(e)
{
    e.originalEvent.key == 'Enter' && download();
}
function focusNewDownloadInput()
{
    showToast(browser.i18n.getMessage('toast_enter_to_download'));
}
function blurNewDownloadInput()
{
    delayHideToast();
}
function addBulkUrl2List()
{
    const $bulk = $('#dl-multiple-bulk-url'),
          $textarea = $('#dl-multiple-url');

    if ($bulk.hasClass('is-invalid')) return;

    const result = braceExpansion($bulk.val());
    if (!$textarea.val() || /\n$/.test($textarea.val()))
        $textarea.val($textarea.val() + result.join('\n')).trigger('input');
    else
        $textarea.val($textarea.val() + '\n' + result.join('\n')).trigger('input');
}

/*********************************
  Source download modal functions
 *********************************/
function updateSourceList()
{
    const list = bg.lastSource.list,
          urls = Object.keys(list);

    // data
    for (let url of urls) {
        if (!allowProtocol.test(list[url].protocol)) continue;
        for (let i=0; i<list[url].tag.length; i++)
            source.push(Object.assign({}, list[url],
                                      { tag   : list[url].tag[i],
                                        title : list[url].title[i] }));
    }
}

function keypressSourceInput(e)
{
    if ($('#source-download-button1').prop('disabled')) return;
    e.originalEvent.key == 'Enter' && sourceDownload();
}

function focusSourceInput()
{
    if ($('#source-download-button1').prop('disabled'))
        hideToast();
    else
        showToast(browser.i18n.getMessage('toast_enter_to_download'));
}

function blurSourceInput()
{
    delayHideToast();
}

function changeSourceAll()
{
    const output = (resolve, reject) => {
        $('#source-list .source-url-input').prop('checked', this.checked);
        // count downloads
        const count = $('#source-list .source-url-input:checked').length;
        $('#source-download-button1, #source-download-button2').attr('data-count', count).prop('disabled', count == 0);
        focusSourceInput();
        resolve();
    };

    if ($('#source-list .source-item').length < MAX_FILTER_CNT)
        return new Promise(output);
    else {
        const $loading = $('#loading-cover');
        return new Promise((resolve, reject) => {
            // loading start
            $loading.on('transitionend', async function() {
                $(this).off('transitionend');
                await new Promise(output);
                // loading end
                $loading.on('transitionend', function() {
                    $(this).off('transitionend');
                    resolve();
                }).removeClass('show');
            }).addClass('show');
        });
    }
}

function changeSourceItem()
{
    // count downloads
    const count = $('#source-list .source-url-input:checked').length;
    $('#source-download-button1, #source-download-button2').attr('data-count', count).prop('disabled', count == 0);
}

function checkSourceItem(e)
{
    // if clicking checkbox, re-toggle
    if (e.target === $(this).find('.source-url-input')[0])
        $(e.target).prop('checked', (i, v) => !v).change();

    // shift clicked
    if (e.originalEvent.shiftKey) {
        const now  = $(this).index(),
              last = $(this).siblings('[data-last-selected=true]').index();
        if (last < 0) {
            // input toggle
            $(this).find('.source-url-input').prop('checked', (i, v) => !v).change();
        }
        else if (now < last) {
            // input toggle
            $(this).parent().children().slice(now, last).find('.source-url-input').prop('checked', (i, v) => !v).change();
        }
        else {
            // input toggle
            $(this).parent().children().slice(last+1, now+1).find('.source-url-input').prop('checked', (i, v) => !v).change();
        }
    }
    // shift not clicked
    else {
        // input toggle
        $(this).find('.source-url-input').prop('checked', (i, v) => !v).change();
    }

    // last checked
    $(this).attr('data-last-selected', true).siblings().attr('data-last-selected', false);
    // foucs checkbox
    $(this).find('.source-url-input').focus();
}

function sortSourceItems()
{
    const targets = ['sort-url', 'sort-filetype', 'sort-tag'];
    if (this.dataset.order == 'asc') this.dataset.order = 'desc';
    else if (this.dataset.order == 'desc') this.dataset.order = '';
    else this.dataset.order = 'asc';
    for (let target of targets)
        if (this.id != target) $('#' + target).attr('data-order', '');
    outputSourceList();
}

function outputSourceList()
{
    const docfrag = new DocumentFragment();

    const output = (resolve, reject) => {
        // run all filter
        const list = sortSourceList(
            filterDuplicateSourceList(
                filterSourceList(
                    filterTypeSourceList(
                        filterTagnameSourceList()))));

        // all checkbox uncheck
        $('#source-all').prop('checked', false);
        $('#source-download-button1, #source-download-button2').attr('data-count', 0).prop('disabled', true);

        // clear list
        docfrag.appendChild($('#source-list').children()[0]);
        $('#source-list').empty();

        // html
        const $template = $('#source-item-template'),
              $urlInput = $template.find('input'),
              $urlLabel = $template.find('span'),
              $type     = $template.find('.source-type'),
              $tag      = $template.find('.source-tag'),
              $title    = $template.find('.source-title');
        let i = null;

        for (i in list) {
            // checkbox id & attr
            $urlInput.attr({ id : 'source' + i, value : list[i].url });
            // label for & text
            $urlLabel.text(list[i].url);
            // extension
            $type.text(list[i].filetype);
            // tag
            $tag.text(list[i].tag);
            // title
            $title.text(list[i].title).attr('title', list[i].title);

            docfrag.appendChild($template.clone().attr({ id : null, 'data-filetype' : list[i].filetype })[0]);
        }
        $('#source-list')[0].appendChild(docfrag);
        // i == null -> no list item
        resolve(i == null ? 0 : ++i);
    };

    if (source.length < MAX_FILTER_CNT)
        return new Promise(output);
    else {
        const $loading = $('#loading-cover');
        return new Promise((resolve, reject) => {
            // loading start
            $loading.on('transitionend', async function() {
                $(this).off('transitionend');
                const ret = await new Promise(output);
                // loading end
                $loading.on('transitionend', function() {
                    $(this).off('transitionend');
                    resolve(ret);
                }).removeClass('show');
            }).addClass('show');
        });
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
                let re = new RegExp('^(' + $tagnamelist.val().trim() + ')$');
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
            if ($('#filter-filetype1').prop('checked') && filter1.test(a.filetype)
                || $('#filter-filetype2').prop('checked') && filter2.test(a.filetype)
                || $('#filter-filetype3').prop('checked') && filter3.test(a.filetype)
                || $('#filter-filetype4').prop('checked') && filter4.test(a.filetype)
                || $('#filter-filetype5').prop('checked') && filter5.test(a.filetype)
                || $('#filter-filetype6').prop('checked') && filter6.test(a.filetype)) return true;
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
    $('a.collapse-toggle-link[href="#byTagname"]').attr('data-filtered', $('#filter-tagnamelist').val().trim().length != 0 ? 'true' : '');
    $('a.collapse-toggle-link[href="#byFiletype"]').attr('data-filtered', $('#byFiletype input:checked').length != 0 ? 'true' : '');
    $('a.collapse-toggle-link[href="#byKeyword"]').attr('data-filtered', $('#filter-expression').val().length != 0 ? 'true' : '');
}

/************************
  Detail modal functions
 ************************/
function switchDetail()
{
    let $target;

    if (this.id == 'detail-next-button')
        $target = $('#item-' + this.dataset.dlid).next('.download-item');
    else
        $target = $('#item-' + this.dataset.dlid).prev('.download-item');

    if ($target.length != 0) {
        // update dlid
        $('#download-detail, #download-detail [data-dlid]').attr('data-dlid', $target.attr('id').split('-')[1]);
        // update detail
        updateDetail(true);
    }
}

function detailTile()
{
    const box   = [],
          $tile = $('<div class="detail-tile" data-status="" />');
    [...Array(TILE_SIZE)].forEach(() => { box.push($tile.clone()); });
    return box;
}

function updateDetail(init)
{
    const dlid      = $('#download-detail').attr('data-dlid'),
          queue     = bg.downloadQueue[dlid],
          loadedObj = queue.loaded;

    // init
    if (init) {
        $('#detail-status-dlid').val(dlid);
        $('#detail-info-mode').val(queue.mode ? browser.i18n.getMessage('download_detail_mode_' + queue.mode) : browser.i18n.getMessage('download_detail_mode_normal'));
        $('#detail-info-registered').val(new Date(queue.regTime).toLocaleString());
        $('#detail-info-url').val(queue.originalUrlInput);
        $('#detail-info-url-open').attr('data-link', queue.originalUrlInput);
        let referer = queue.requestHeaders.find((ele) => { return ele.name == 'X-DAS-Referer'; });
        $('#detail-info-user').val(queue.option.authentication[0]);
        $('#detail-info-referer').val(referer.value ? referer.value : '(none)');
        $('#detail-info-referer-open').attr('data-link', referer.value);
        $('#detail-info-filename').parent().attr('data-editing', '');
        $('#detail-info-filename').addClass('form-control-plaintext').removeClass('form-control is-invalid')
            .val(() => {
                if (queue.autoFilename) return queue.autoFilename + ' (auto)';
                return queue.filename || queue.responseFilename || '';
            });
        $('#detail-info-location').parent().attr('data-editing', '');
        $('#detail-info-location').addClass('form-control-plaintext').removeClass('form-control is-invalid')
            .val(queue.location);
        $('#detail-info-option1').prop('checked', queue.option.disableResuming);
        $('#detail-info-option2').prop('checked', queue.option.ignoreSizemismatch);
        $('#detail-info-split-count').val(queue.option.disableResuming ? 0 : queue.splitCount);
    }

    // download finished
    if (!/waiting|downloading|paused/.test(queue.status)) {
        $('#detail-info-filename').parent().attr('data-editing', '');
        $('#detail-info-filename').addClass('form-control-plaintext').removeClass('form-control is-invalid')
            .val(() => {
                if (queue.autoFilename) return queue.autoFilename + ' (auto)';
                return queue.filename || queue.responseFilename || '';
            });
        $('#detail-info-location').parent().attr('data-editing', '');
        $('#detail-info-location').addClass('form-control-plaintext').removeClass('form-control is-invalid')
            .val(queue.location);
    }

    $('#download-detail').attr('data-status', queue.status);
    $('#detail-status-status').val(queue.status);
    $('#detail-status-reason').val(queue.reason);
    $('#detail-status-start').val(queue.startTime ? new Date(queue.startTime).toLocaleString() : '');
    $('#detail-status-end').val(queue.endTime ? new Date(queue.endTime).toLocaleString() : '');
    $('#detail-status-url').val(queue.responseUrl && queue.responseUrl.href.replace(/:\/\/.+@/,'://'));
    $('#detail-status-url-open').attr('data-link', queue.responseUrl && queue.responseUrl.href.replace(/:\/\/.+@/,'://'));
    $('#detail-status-user').val(queue.responseUrl && queue.responseUrl.username);
    $('#detail-status-mime').val(queue.contentType);
    $('#detail-status-current').val(loadedObj.now.toLocaleString());
    if (queue.total) {
        let progress = parseInt(loadedObj.now / queue.total * 100);
        $('#detail-status-progress').css('width', progress + '%').text(progress + '%');
        $('#detail-status-total').val(queue.total.toLocaleString());
    }
    else {
        $('#detail-status-progress').css('width', '100%').text('unknown');
        $('#detail-status-total').val('unknown');
    }
    $('#detail-status-thread-count').val(queue.data.filter(d => d.status == 'downloading').length);

    // finished
    $('#detail-info-filename-open').attr('data-fxid', queue.fxid);
    $('#detail-info-location-open').attr('data-fxid', queue.fxid);

    // tile
    queue.detail.forEach((val, index) => {
        $('#detail-status-detail').children().eq(index).attr('data-status', val || '');
    });
}

/******************
  Dialog functions
 ******************/
function confirmDialog(e)
{
    const dlid = this.dataset.dlid = e.relatedTarget.dataset.dlid;

    switch (e.relatedTarget.dataset.action) {
    case 'stop-downloading':
        $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_downloading'));
        $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
            .off('click')
            .on('click', stopDownload);
        break;
    case 'pause-downloading':
        bg.downloadQueue[dlid].resumeEnabled
            ? $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_pause_downloading_resumable'))
            : $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_pause_downloading_nonresumable'));
        $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_pause'))
            .off('click')
            .on('click', pauseDownload);
        break;
    case 'stop-waiting':
        $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_waiting'));
        $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
            .off('click')
            .on('click', stopDownload);
        break;
    case 'stop-all-downloading':
        $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_all_downloading'));
        $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
            .off('click')
            .on('click', stopDownloading);
        break;
    case 'stop-all-waiting':
        $(this).find('.modal-body').text(browser.i18n.getMessage('confirm_stop_all_waiting'));
        $(this).find('.modal-action-button').text(browser.i18n.getMessage('button_stop'))
            .off('click')
            .on('click', stopWaiting);
        break;
    }
}

/*****************
  Toast functions
 *****************/
function showToast(text)
{
    $('#toast').stop(true, true).fadeIn(400).find('.toast-body').text(text);
}

function hideToast()
{
    $('#toast').fadeOut(400);
}

function delayHideToast()
{
    $('#toast').delay(200).fadeOut(400);
}

function showAutoHideToast(text)
{
    $('#toast').stop(true, true).fadeIn(400).delay(4000).fadeOut(400).find('.toast-body').text(text);
}
