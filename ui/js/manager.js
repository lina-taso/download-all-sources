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
      allowFilename = /^([^/\\:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|refdom|name|ext|mext):))*$/,
      allowLocation = /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|name|ext|mime|mext):))*$/,
      // include tags such as tag and title for source download
      allowFilenameS= /^([^/\\:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|refdom|tag|title|name|ext|mext):))*$/,
      allowLocationS= /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|tag|name|ext|mime|mext):))*$/,
      // not include any tags for detail modal
      allowFilenameD= /^[^/\\:,;*?"<>|]*$/,
      allowLocationD= /^[^:,;*?"<>|]*$/,
      denyFilename  = /^[. ]+|[. ]+$/,
      denyLocation  = /^[. ]+|\/[. ]+|[. ]+\/|^\/|(\.\/|\.\.\/|\/\/)/,
      defaultTitle  = 'no-title';

// valuables
let source     = [],
    prevLoadedKB = null, prevLoadedTime = null,
    baseurl,
    filter1, filter2, filter3, filter4, filter5, filter6,
    totalGraph;


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    localization();
    createGraph();
    updateList();
    setInterval(updateList, progressInterval);
    // miscellanies events
    $('.openlink-button').on('click', function() { this.dataset.link && browser.tabs.create({ url : this.dataset.link }); });
    $('.openfile-button, .item-openfile-button').on('click', async function() { this.dataset.fxid && browser.downloads.open( parseInt(this.dataset.fxid)); });
    $('.openlocation-button, .item-openlocation-button').on('click', async function() { this.dataset.fxid && browser.downloads.show( parseInt(this.dataset.fxid)); });
    // all tooltip enabled
    $('[data-bs-toggle=tooltip]').tooltip({ title : function() {
        return browser.i18n.getMessage(this.dataset.titlestring);
    }});
    // download buttons
    $('#download-button').on('click', download);
    $('#source-download-button1, #source-download-button2').on('click', sourceDownload);
    $('#setting-button').on('click', () => { browser.runtime.openOptionsPage(); });
    // finished list
    $('#finished-delete-button')
        .on('click', function() {
            $('#finished-list').children('.download-item').each(function() {
                bg.deleteQueue(this.id.split('-')[1]);
                $(this).remove();
            });
        });
    // item
    $('.item-resume-button').on('click', resumeDownload);
    $('.item-redo-button').on('click', reDownload);
    $('.item-delete-button')
        .on('click', function() {
            bg.deleteQueue(this.dataset.dlid);
            $('#item-' + this.dataset.dlid).remove();
        });

    // source list item
    $('#source-list')
        .on('click', '.source-item', function(e) {
            // disable clicking checkbox
            if (e.target === $(this).find('.source-url-input')[0]) return;
            $(this).find('.source-url-input').prop('checked', !$(this).find('.source-url-input').prop('checked')).change();
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
    // source list filter
    $('#byTagname input, #byFiletype input, #byKeyword input')
        .on('input', function() {
            if (source.length < MAX_FILTER_CNT) { checkActiveFilter(); outputSourceList(); }
        });
    $('#filter-dup')
        .on('input', function() {
            checkActiveFilter(); outputSourceList();
        });
    // source list filter button
    $('#filter-tagnamelist-button, #filter-type-button, #filter-expression-button')
        .on('click', function() {
            checkActiveFilter(); outputSourceList();
        });
    // checkbox validation
    $('#dl-single-option1, #dl-multiple-option1, #dl-source-option1').on('input', checkDownloadOptions);

    // modal
    $('#new-download')
        .on('show.bs.modal', async function() {
            // default-referer from new button
            if (!baseurl) {
                $('#dl-single-referer-default').prop('checked', false).trigger('input');
                $('#dl-single-referer-default-group').css('display', 'none');
            }

            // initial value
            const config = await bg.config.getPref();
            // initial authentication
            $('#dl-single-user, #dl-multiple-user, #dl-single-pass, #dl-multiple-pass').val('');
            // initial referer
            $('#dl-single-referer, #dl-multiple-referer').val(config['remember-new-referer'] ? config['new-referer-value'] : '');
            // initial filename
            $('#dl-single-filename, #dl-multiple-filename').val(config['remember-new-filename'] ? config['new-filename-value'] : '').trigger('input');
            // initial location
            $('#dl-single-location, #dl-multiple-location').val(config['remember-new-location'] ? config['new-location-value'] : '').trigger('input');
            // initial option1
            $('#dl-single-option1, #dl-multiple-option1').prop('checked', config['remember-new-option1'] ? config['new-option1-value'] : false).trigger('input');
            // initial option2
            $('#dl-single-option2, #dl-multiple-option2').prop('checked', config['remember-new-option2'] ? config['new-option2-value'] : false).trigger('input');
        })
        .on('shown.bs.modal', function() { $(this).find('[data-focus=true]').focus(); })
        .on('hide.bs.modal', function() { baseurl = null; });
    // in new download modal
    $('#dl-single-url').on('keypress', (e) => { e.originalEvent.key == 'Enter' && download(); });
    $('#dl-single-referer-default')
        .on('input', function() {
            if (this.checked)
                $('#dl-single-referer').val(baseurl).prop('readonly', true).removeClass('is-invalid').trigger('input');
            else
                $('#dl-single-referer').val('').prop('readonly', false).trigger('input');
        });
    // modal
    $('#download-detail')
        .on('show.bs.modal', function(e) {
            const button = e.relatedTarget;
            // update dlid
            $('#download-detail, #detail-next-button, #detail-prev-button, #detail-stop-button, #detail-pause-button, #detail-resume-button, #detail-redo-button, #detail-redo-button-manual')
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
    $('#detail-redo-button-manual').on('click', reDownloadManual);
    $('#detail-next-button, #detail-prev-button')
        .on('click', function() {
            let $target;

            if (this.id == 'detail-next-button')
                $target = $('#item-' + this.dataset.dlid).next('.download-item');
            else
                $target = $('#item-' + this.dataset.dlid).prev('.download-item');

            if ($target.length != 0) {
                // update dlid
                $('#download-detail, #detail-next-button, #detail-prev-button, #detail-stop-button, #detail-pause-button, #detail-resume-button, #detail-redo-button, #detail-redo-button-manual')
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
            if ($input.val() === '') $input.val(queue.responseFilename);
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
            const valid = allowFilenameD.test(this.value) && !denyFilename.test(this.value);
            $(this).toggleClass('is-invalid', !valid);
        });
    // location validation
    $('#detail-info-location')
        .on('input', function() {
            const location = bg.normalizeLocation(this.value);
            const valid = allowLocationD.test(location) && !denyLocation.test(location);
            $(this).toggleClass('is-invalid', !valid);
        });
    // modal
    $('#source-download')
        .on('show.bs.modal', async () => {
            // only once
            $('#source-all').on('input', function() {
                const output = (resolve, reject) => {
                    if (this.checked)
                        $('#source-list .source-url-input').prop('checked', true);
                    else
                        $('#source-list .source-url-input').prop('checked', false);

                    // count downloads
                    $('#source-download-button1, #source-download-button2').attr(
                        'data-count',
                        $('#source-list .source-url-input:checked').length
                    );

                    resolve();
                };

                if ($('#source-list .source-item').length < MAX_FILTER_CNT)
                    new Promise(output);
                else {
                    const $loading = $('#loading-cover');
                    // loading start
                    $loading.on('transitionend', async function() {
                        $(this).off('transitionend');

                        await new Promise(output);
                        // loading end
                        $loading.removeClass('show');

                    }).addClass('show');
                }
            });
            $('#source-list').on('change', '.source-url-input', function() {
                // count downloads
                $('#source-download-button1, #source-download-button2').attr(
                    'data-count',
                    $('#source-list .source-url-input:checked').length
                );
            });
            // filter button
            if (source.length >= MAX_FILTER_CNT) {
                $('#filter-tagnamelist-button, #filter-type-button, #filter-expression-button')
                    .parent().removeClass('d-none');
            }

            // default-referer
            $('#dl-source-referer-default').on('input', function() {
                if (this.checked)
                    $('#dl-source-referer').val(baseurl).prop('readonly', true).removeClass('is-invalid').trigger('input');
                else
                    $('#dl-source-referer').val('').prop('readonly', false).trigger('input');
            });
            // initial value
            const config = await bg.config.getPref();
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
        })
        .on('shown.bs.modal', async () => {
            outputSourceList();
        })
        .on('hidden.bs.modal', function() {
            baseurl = null;
            $(this).remove();
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
                        $('#downloading-list').children('.download-item').each(function() {
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
    $('#dl-single-url')
        .on('input', function() {
            if (!this.value) {
                $(this).toggleClass('is-invalid', false);
                return;
            }
            try {
                new URL(this.value);
                if (!allowProtocol.test(this.value))
                    $(this).toggleClass('is-invalid', true);
                else
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
                    if (!allowProtocol.test(line))
                        $(this).toggleClass('is-invalid', true);
                    else
                        $(this).toggleClass('is-invalid', false);
                });
            }
            catch (e) {
                $(this).toggleClass('is-invalid', true);
            }
        });
    // authentication validation
    $('#dl-single-user, #dl-single-pass')
        .on('input', function() {
            $('#dl-single-user').toggleClass('is-invalid', $('#dl-single-user').val() == '' && $('#dl-single-pass').val() != '');
        });
    $('#dl-multiple-user, #dl-multiple-pass')
        .on('input', function() {
            $('#dl-multiple-user').toggleClass('is-invalid', $('#dl-multiple-user').val() == '' && $('#dl-multiple-pass').val() != '');
        });
    $('#dl-source-user, #dl-source-pass')
        .on('input', function() {
            $('#dl-source-user').toggleClass('is-invalid', $('#dl-source-user').val() == '' && $('#dl-source-pass').val() != '');
        });
    // referer validation
    $('#dl-single-referer, #dl-multiple-referer, #dl-source-referer')
        .on('input', function() {
            const $filename = $('#' + this.id.replace('referer', 'filename')),
                  $location = $('#' + this.id.replace('referer', 'location'));

            if (!this.value) {
                const valid = !/:refdom:/.test($filename.val()) || !/:refdom:|:refpath:/.test($location.val());
                $(this).toggleClass('is-invalid', !valid);
                $filename.trigger('input'), $location.trigger('input');
                return;
            }
            try {
                new URL(this.value);
                $(this).toggleClass('is-invalid', false);
                $filename.trigger('input'), $location.trigger('input');
            }
            catch (e) {
                const valid = !(
                    /:refdom:/.test($filename.val()) && $filename.addClass('is-invalid') ||
                    /:refdom:|:refpath:/.test($location.val()) && $location.addClass('is-invalid'));
                $(this).toggleClass('is-invalid', !valid);
            }
        });
    // filename validation
    $('#dl-single-filename, #dl-multiple-filename, #dl-source-filename')
        .on('input', function() {
            const $referer     = $('#' + this.id.replace('filename', 'referer')),
                  allowPattern = this.id != 'dl-source-filename' ? allowFilename : allowFilenameS,
                  valid        =
                  // referer tag is not included, referer is valid if empty
                  ( !/:refdom:/.test(this.value) && ($referer.val() || !$referer.val() && $referer.removeClass('is-invalid')) ||
                    // referer tag is included, referer is invalid if empty
                    !$referer.val() && !$referer.addClass('is-invalid') || $referer.val() && !$referer.hasClass('is-invalid') ) &&
                  // pattern validation
                  allowPattern.test(this.value) && !denyFilename.test(this.value);

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
        });
    // location validation
    $('#dl-single-location, #dl-multiple-location, #dl-source-location')
        .on('input', async function() {
            const defaultLocation = await bg.config.getPref('download-location'),
                  location        = bg.normalizeLocation(defaultLocation + this.value),
                  $referer        = $('#' + this.id.replace('location', 'referer')),
                  allowPattern    = this.id != 'dl-source-location' ? allowLocation : allowLocationS,
                  valid           =
                  // referer tag is not included, referer is valid if empty
                  ( !/:refdom:|:refpath:/.test(this.value) && ($referer.val() || !$referer.val() && $referer.removeClass('is-invalid')) ||
                    // referer tag is included, referer is invalid if empty
                    !$referer.val() && !$referer.addClass('is-invalid') || $referer.val() && !$referer.hasClass('is-invalid') ) &&
                  // pattern validation
                  allowPattern.test(location) && !denyLocation.test(location);

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
        });

    // tag insertion
    $('.tags')
        .on('click', 'dt > a[href="#"]', function(e) {
            $(e.delegateTarget).prev().children('input')[0].value += this.text;
            $(e.delegateTarget).prev().children('input').eq(0).trigger('input');
        });

    // hash anchor (auto tab showing)
    switch (document.location.hash) {
    case '#downloading':
    case '#waiting':
    case '#finished':
        $('[href="'+document.location.hash+'"]').tab('show');
        break;
    case '#new':
        baseurl = bg.lastSource.baseurl;
        $('#new-download').on('shown.bs.modal', setParameters);
        $('#new-download').modal('show');

        async function setParameters() {
            const config = await bg.config.getPref();

            $('#dl-single-url').val(bg.lastSource.link);
            // default-referer
            if (!config['remember-new-referer'] || config['remember-new-referer'] && config['new-referer-default-value'])
                $('#dl-single-referer-default').prop('checked', true).trigger('input');
            else if (config['remember-new-referer']) {
                $('#dl-single-referer-default').prop('checked', false);
                $('#dl-single-referer').val(config['new-referer-value']);
            }
            bg.lastSource = {};

            $('#new-download').off('shown.bs.modal', setParameters);
        }

        break;
    case '#source':
        baseurl = bg.lastSource.baseurl;
        updateSourceList();
        bg.lastSource = {};
        $('#source-download').modal('show');
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
                  refererUrl : baseurl,
                  tag        : tag
              }),
              originalLocation : $('#dl-source-location').val() },
            { filename :
              bg.replaceTags({ // filename
                  path       : $('#dl-source-filename').val(),
                  targetUrl  : targetUrl,
                  refererUrl : baseurl,
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
    $('#new-download').on('shown.bs.modal', setParameters);
    $('#new-download').modal('show');

    function setParameters() {
        $('#single-tab').tab('show');
        $('#dl-single-url').val(queue.originalUrlInput);
        $('#dl-single-user').val(queue.option.authentication[0]);
        $('#dl-single-pass').val(queue.option.authentication[1]);
        if (queue.option.authentication[0]) $('#new-download-single-authentication').collapse('show');
        const referer = queue.requestHeaders.find((ele) => { return ele.name == 'X-DAS-Referer'; });
        $('#dl-single-referer').val(referer.value).trigger('input');
        $('#dl-single-location').val(queue.originalLocation).trigger('input');
        $('#dl-single-filename').val(queue.originalFilename).trigger('input');
        $('#dl-single-option1').prop('checked', queue.option.disableResuming).trigger('input');
        $('#dl-single-option2').prop('checked', queue.option.ignoreSizemismatch).trigger('input');

        $('#new-download').off('shown.bs.modal', setParameters);
    }
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
          loadedObj = queue.loaded;

    // init
    if (init) {
        $('#detail-status-dlid').val(dlid);
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

    // finished
    $('#detail-info-filename-open').attr('data-fxid', queue.fxid);
    $('#detail-info-location-open').attr('data-fxid', queue.fxid);

    // tile
    queue.detail.forEach((val, index) => {
        $('#detail-status-detail').children().eq(index).attr('data-status', val || '');
    });
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

function updateGraph(Bps)
{
    totalGraph.data.datasets[0].data.shift();
    totalGraph.data.datasets[0].data.push(Bps);
    totalGraph.update();
}

function updateList()
{
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
                if ($('#waiting-list').has($item).length)
                    continue;
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
                    $item[0].chart.destroy();
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
        else
            $item.find('.item-progress').css('width', '100%').text(calcByte(loadedObj.now) + ' / ' + 'unknown');
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
            $item.find('.item-speed').text(calcBps({ now : queue.loaded.now, nowTime : queue.endTime, prev : 0, prevTime : queue.startTime }));
            $item.find('.item-remain').text(parseInt((queue.endTime - queue.startTime) / 1000) + 's');
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
        if (!loadedObj.now || !total) return 'unknown';

        const remain = (total - loadedObj.now) / loadedObj.Bps;

        // too long (over 30 days)
        if (remain > 86400 * 30) return 'stalled';

        return Math.floor(remain) + ' s';
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
        $('#source-download-button1, #source-download-button2').attr('data-count', 0);

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

        for (let i in list) {
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

            docfrag.appendChild($template.clone().attr({ id : '', 'data-filetype' : list[i].filetype })[0]);
        }
        $('#source-list')[0].appendChild(docfrag);
        resolve();
    };

    if (source.length < MAX_FILTER_CNT)
        new Promise(output);
    else {
        const $loading = $('#loading-cover');
        // loading start
        $loading.on('transitionend', async function() {
            $(this).off('transitionend');

            await new Promise(output);
            // loading end
            $loading.removeClass('show');

        }).addClass('show');
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
    $('[data-string-placeholder]').each(function() {
        $(this).attr('placeholder', browser.i18n.getMessage(this.dataset.stringPlaceholder));
    });
    $('[data-configstring]').each(function() {
        $(this).text(config[this.dataset.configstring]);
    });
}
