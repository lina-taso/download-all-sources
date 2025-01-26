/**
 * @fileOverview Download All Sources Manager content script
 * @name options.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

// background
var bg;

const allowLocation = /^([^:*?"<>|\t]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|name|ext|mime|mext):))*$/,
      denyLocation  = /^[. ]+|\/[. ]+|[. ]+\/|^\/|(\.\/|\.\.\/|\/\/)/,
      allowSimultaneous = /^([1-9]|1[0-9]|2[0-4])$/,
      allowSplitCount = /^([1-9]|10)$/,
      allowMimetype = /^\S+$/,
      allowExtension= /^([A-Za-z0-9]+|[A-Za-z0-9]+(\.[A-Za-z0-9]+)+)$/;


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    await bg.initialized();
    localization();
    applyTheme();

    // all tooltip enabled
    $('[data-bs-toggle=tooltip]').each(function() {
        new bootstrap.Tooltip(this, { title : browser.i18n.getMessage(this.dataset.titlestring) });
    });

    // input range
    $('#simultaneous-whole, #simultaneous-per-server, #retry-count, #split-count, #split-size, #split-ex-size')
        .on('input', function() {
            $('#' + this.id + '-label').text(this.value);
        });

    // initial preference
    const config = bg.config.getPref();
    $('input').each(function () {
        const id = $(this).attr('id');
        if (!id) return;
        switch (this.type) {
        case 'checkbox':
            this.checked = config[id];
            break;
        default:
            this.value = config[id];
        }
    });

    // initial server specific parameters
    const $paramTemplate = $('.row.server-parameter.d-none'),
          serverParams   = Object.keys(config['server-parameter']);
    for (let key of serverParams) {
        const $target = $paramTemplate.clone().removeClass('d-none').appendTo($paramTemplate.parent());
        $target.find('.server-fqdn-punycode').val(key);
        $target.find('.server-fqdn').val(config['server-parameter'][key].fqdn);
        $target.find('.server-simultaneous').val(config['server-parameter'][key].simultaneous);
        $target.find('.server-split-count').val(config['server-parameter'][key]['split-count']);
        $target.find('.server-disable-resuming').prop('checked', config['server-parameter'][key]['disable-resuming']);
        $target.find('.server-ignore-sizemismatch').prop('checked', config['server-parameter'][key]['ignore-sizemismatch']);
    }
    // empty box
    $paramTemplate.clone().removeClass('d-none').appendTo($paramTemplate.parent());

    // initial authentication parameters
    const $authTemplate = $('.row.authentication-parameter.d-none'),
          authParams    = Object.keys(config['authentication-parameter']);
    for (let key of authParams) {
        const $target = $authTemplate.clone().removeClass('d-none').appendTo($authTemplate.parent());
        $target.find('.authentication-url-punycode').val(key);
        $target.find('.authentication-url').val(config['authentication-parameter'][key].url);
        $target.find('.authentication-user').val(config['authentication-parameter'][key].user);
        $target.find('.authentication-pass').val(config['authentication-parameter'][key].pass);
        if (!config['authentication-parameter'][key].user && !config['authentication-parameter'][key].pass) {
            $target.find('.authentication-user').prop('disabled', true);
            $target.find('.authentication-pass').prop('disabled', true);
            $target.find('.authentication-noauth').prop('checked', true);
        }
    }
    // empty box
    $authTemplate.clone().removeClass('d-none').appendTo($authTemplate.parent());

    // initial customscript parameters
    const $scriptTemplate = $('.row.customscript-parameter.d-none'),
          scriptParams    = Object.keys(config['customscript-parameter']);
    for (let key of scriptParams) {
        const $target = $scriptTemplate.clone().removeClass('d-none').appendTo($scriptTemplate.parent());
        $target.find('.customscript-url-punycode').val(key);
        $target.find('.customscript-url').val(config['customscript-parameter'][key].url);
        $target.find('.customscript-script').val(config['customscript-parameter'][key].script);
    }
    // empty box
    $scriptTemplate.clone().removeClass('d-none').appendTo($scriptTemplate.parent());

    // initial mime mapipngs
    const $mapTemplate = $('.row.mime-mapping.d-none'),
          mimeMappings = Object.keys(config['mime-mappings']);
    for (let key of mimeMappings) {
        let $target = $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());
        $target.find('.mime-mime').val(key);
        $target.find('.mime-ext').val(config['mime-mappings'][key]);
    }
    // empty box
    $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());

    $('#simultaneous-whole, #simultaneous-per-server, #retry-count, #split-count, #split-size, #split-ex-size')
        .each(function() {
            $('#' + this.id + '-label').text(this.value);
        });

    // input event
    $('input, textarea').on('input', function() {
        switch(this.type) {
        case 'checkbox':
            // exclusive checkbox
            if (this.id == 'contextmenu-add-ext-filename' && this.checked == true)
                $('#contextmenu-add-mext-filename').prop('checked', false).trigger('input');
            if (this.id == 'contextmenu-add-mext-filename' && this.checked == true)
                $('#contextmenu-add-ext-filename').prop('checked', false).trigger('input');

            // server specific parameter
            if (this.classList.contains('server-parameter-box')) {
                // save pref
                if (!$('.server-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.server-parameter').each(function() {
                        if ($(this).find('.server-fqdn').val() == '') return;
                        parameters[$(this).find('.server-fqdn-punycode').val()] = {
                            fqdn                  : $(this).find('.server-fqdn').val(),
                            simultaneous          : parseInt($(this).find('.server-simultaneous').val()),
                            'split-count'         : parseInt($(this).find('.server-split-count').val()),
                            'disable-resuming'    : $(this).find('.server-disable-resuming').prop('checked'),
                            'ignore-sizemismatch' : $(this).find('.server-ignore-sizemismatch').prop('checked')
                        };
                    });
                    bg.config.setPref('server-parameter', parameters);
                }
                return;
            }

            // authentication parameter
            if (this.classList.contains('authentication-parameter-box')) {
                // validation
                // no auth
                if (this.classList.contains('authentication-noauth')) {
                    if (this.checked) {
                        $(this).closest('.authentication-parameter').find('.authentication-user, .authentication-pass').val('').prop('disabled', true).removeClass('is-invalid');
                    }
                    else {
                        $(this).closest('.authentication-parameter').find('.authentication-user, .authentication-pass').prop('disabled', false);
                        if ($(this).closest('.authentication-parameter').find('.authentication-url').val()) {
                            $(this).closest('.authentication-parameter').find('.authentication-user').addClass('is-invalid');
                        }
                    }
                }

                // save pref
                if (!$('.authentication-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.authentication-parameter').each(function() {
                        if ($(this).find('.authentication-url').val() == '') return;
                        parameters[$(this).find('.authentication-url-punycode').val()] = {
                            url  : $(this).find('.authentication-url').val(),
                            user : $(this).find('.authentication-user').val(),
                            pass : $(this).find('.authentication-pass').val()
                        };
                    });
                    bg.config.setPref('authentication-parameter', parameters);
                }
                return;
            }

            // customscript parameter
            if (this.classList.contains('customscript-parameter-box')) {
                // validation
                if ($(this).closest('.customscript-parameter').find('.customscript-url').val()) {
                    $(this).closest('.customscript-parameter').find('.customscript-script').addClass('is-invalid');
                }

                // save pref
                if (!$('.customscript-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.customscript-parameter').each(function() {
                        if ($(this).find('.customscript-url').val() == '') return;
                        parameters[$(this).find('.customscript-url-punycode').val()] = {
                            url    : $(this).find('.customscript-url').val(),
                            script : $(this).find('.customscript-script').val()
                        };
                    });
                    bg.config.setPref('customscript-parameter', parameters);
                }
                return;
            }

            bg.config.setPref(this.id, this.checked);
            // clear saved value
            if (this.dataset.value) {
                this.dataset.value.split(' ').forEach((key) => {
                    bg.config.setPref(key, null);
                });
            }
            break;
        case 'range':
            bg.config.setPref(this.id, Number(this.value));
            break;
        default:
            // location
            if (this.id == 'download-location') {
                const location = bg.normalizeLocation(this.value),
                      valid    = allowLocation.test(location) && !denyLocation.test(location);
                $(this).toggleClass('is-invalid', !valid);
                // sample and save pref
                if (valid) {
                    $('#download-location-sample').text(bg.replaceTags({
                        path      : location,
                        targetUrl : 'http://www.example.com/path/name/',
                        name      : 'filename',
                        ext       : 'ext',
                        mime      : 'sample/mime-type'
                    }));
                    bg.config.setPref(this.id, location || null);
                }
                else {
                    $('#download-location-sample').text('');
                }
            }
            // server specific parameter
            else if (this.classList.contains('server-parameter-box')) {
                const $fqdnbox  = $(this).closest('.server-parameter').find('.server-fqdn'),
                      $punybox  = $(this).closest('.server-parameter').find('.server-fqdn-punycode'),
                      $simulbox = $(this).closest('.server-parameter').find('.server-simultaneous'),
                      $splitbox = $(this).closest('.server-parameter').find('.server-split-count'),
                      entered   = $fqdnbox.val() != '';

                // if last is not empty, add new line
                if ($(this).closest('.server-parameter').is(':last-of-type') && entered) {
                    const $paramTemplate = $('.row.server-parameter.d-none');
                    // clone with events
                    $paramTemplate.clone(true).removeClass('d-none').appendTo($paramTemplate.parent());
                }
                // validation
                if (entered) {
                    let fqdnvalid = false;
                    if (!$fqdnbox.val()) {
                        $punybox.val('');
                    }
                    else {
                        try {
                            const url = new URL('http://' + $fqdnbox.val());
                            $punybox.val(url.hostname);
                            fqdnvalid = true;
                        }
                        catch (e) {
                            $punybox.val('');
                        }
                    }
                    const simulvalid = allowSimultaneous.test($simulbox.val()),
                          splitvalid = allowSplitCount.test($splitbox.val());
                    $fqdnbox.toggleClass('is-invalid', !fqdnvalid);
                    $simulbox.toggleClass('is-invalid', !simulvalid);
                    $splitbox.toggleClass('is-invalid', !splitvalid);

                    if (!fqdnvalid || !simulvalid || !splitvalid) return;
                }
                else {
                    $fqdnbox.toggleClass('is-invalid', false);
                    $simulbox.toggleClass('is-invalid', false);
                    $splitbox.toggleClass('is-invalid', false);
                }
                // save pref
                if (!$('.server-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.server-parameter').each(function() {
                        if ($(this).find('.server-fqdn').val() == '') return;
                        parameters[$(this).find('.server-fqdn-punycode').val()] = {
                            fqdn          : $(this).find('.server-fqdn').val(),
                            simultaneous  : parseInt($(this).find('.server-simultaneous').val()),
                            'split-count' : parseInt($(this).find('.server-split-count').val()),
                            'disable-resuming' : $(this).find('.server-disable-resuming').prop('checked'),
                            'ignore-sizemismatch' : $(this).find('.server-ignore-sizemismatch').prop('checked')
                        };
                    });
                    bg.config.setPref('server-parameter', parameters);
                }
            }
            // authentication parameter
            else if (this.classList.contains('authentication-parameter-box')) {
                const $urlbox    = $(this).closest('.authentication-parameter').find('.authentication-url'),
                      $punybox   = $(this).closest('.authentication-parameter').find('.authentication-url-punycode'),
                      $userbox   = $(this).closest('.authentication-parameter').find('.authentication-user'),
                      $passbox   = $(this).closest('.authentication-parameter').find('.authentication-pass'),
                      $noauthbox = $(this).closest('.authentication-parameter').find('.authentication-noauth'),
                      entered    = $urlbox.val() != '';

                // if last is not empty, add new line
                if ($(this).closest('.authentication-parameter').is(':last-of-type') && entered) {
                    const $authTemplate = $('.row.authentication-parameter.d-none');
                    // clone with events
                    $authTemplate.clone(true).removeClass('d-none').appendTo($authTemplate.parent());
                }
                // validation
                if (entered) {
                    let urlvalid = false;
                    if (!$urlbox.val()) {
                        $punybox.val('');
                    }
                    else {
                        try {
                            const url = new URL($urlbox.val());
                            $punybox.val(url.href);
                            urlvalid = true;
                        }
                        catch (e) {
                            $punybox.val('');
                        }
                    }
                    const uservalid = !$noauthbox.prop('checked') && $userbox.val();
                    $urlbox.toggleClass('is-invalid', !urlvalid);
                    $userbox.toggleClass('is-invalid', !uservalid);
                }
                else {
                    $urlbox.toggleClass('is-invalid', false);
                    $userbox.toggleClass('is-invalid', false);
                }
                // save pref
                if (!$('.authentication-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.authentication-parameter').each(function() {
                        if ($(this).find('.authentication-url').val() == '') return;
                        parameters[$(this).find('.authentication-url-punycode').val()] = {
                            url  : $(this).find('.authentication-url').val(),
                            user : $(this).find('.authentication-user').val(),
                            pass : $(this).find('.authentication-pass').val()
                        };
                    });
                    bg.config.setPref('authentication-parameter', parameters);
                }
            }
            // customscript parameter
            else if (this.classList.contains('customscript-parameter-box')) {
                const $urlbox    = $(this).closest('.customscript-parameter').find('.customscript-url'),
                      $punybox   = $(this).closest('.customscript-parameter').find('.customscript-url-punycode'),
                      $scriptbox = $(this).closest('.customscript-parameter').find('.customscript-script'),
                      entered    = $urlbox.val() != '';

                // if last is not empty, add new line
                if ($(this).closest('.customscript-parameter').is(':last-of-type') && entered) {
                    const $scriptTemplate = $('.row.customscript-parameter.d-none');
                    // clone with events
                    $scriptTemplate.clone(true).removeClass('d-none').appendTo($scriptTemplate.parent());
                }
                // validation
                if (entered) {
                    let urlvalid = false;
                    if (!$urlbox.val()) {
                        $punybox.val('');
                    }
                    else {
                        try {
                            const url = new URL($urlbox.val());
                            $punybox.val(url.href);
                            urlvalid = true;
                        }
                        catch (e) {
                            $punybox.val('');
                        }
                    }
                    const scriptvalid = $scriptbox.val() != '';
                    $urlbox.toggleClass('is-invalid', !urlvalid);
                    $scriptbox.toggleClass('is-invalid', !scriptvalid);
                }
                else {
                    $urlbox.toggleClass('is-invalid', false);
                    $scriptbox.toggleClass('is-invalid', false);
                }
                // save pref
                if (!$('.customscript-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.customscript-parameter').each(function() {
                        if ($(this).find('.customscript-url').val() == '') return;
                        parameters[$(this).find('.customscript-url-punycode').val()] = {
                            url    : $(this).find('.customscript-url').val(),
                            script : $(this).find('.customscript-script').val()
                        };
                    });
                    bg.config.setPref('customscript-parameter', parameters);
                }
            }
            // mime filter
            else if (this.classList.contains('mime-filter')) {
                const $mimes = $('.row.mime-mapping:not(.d-none)'),
                      word   = this.value;

                $mimes.each((i, row) => {
                    const $mime = $(row).find('.mime-mime'),
                          $ext  = $(row).find('.mime-ext');

                    $(row).css('display', ($mime.val().includes(word) || $ext.val().includes(word)) ? '' : 'none');
                });
            }
            // mime
            else if (this.classList.contains('mime-mapping-box')) {
                const $mimebox = $(this).closest('.mime-mapping').find('.mime-mime'),
                      $extbox  = $(this).closest('.mime-mapping').find('.mime-ext'),
                      entered  = $mimebox.val() != '' || $extbox.val() != '';

                // if last is not empty, add new line
                if ($(this).closest('.mime-mapping').is(':last-of-type') && entered) {
                    const $mapTemplate = $('.row.mime-mapping.d-none');
                    // clone with events
                    $mapTemplate.clone(true).removeClass('d-none').appendTo($mapTemplate.parent());
                }
                // validation
                if (entered) {
                    const mimevalid = allowMimetype.test($mimebox.val()),
                          extvalid  = allowExtension.test($extbox.val());
                    $mimebox.toggleClass('is-invalid', !mimevalid);
                    $extbox.toggleClass('is-invalid', !extvalid);

                    if (!mimevalid || !extvalid) return;
                }
                else {
                    $mimebox.toggleClass('is-invalid', false);
                    $extbox.toggleClass('is-invalid', false);
                }
                // save pref
                if (!$('.mime-mapping').find('.is-invalid').length) {
                    const mappings = {};
                    $('.mime-mapping').each(function() {
                        if ($(this).find('.mime-mime').val() == '') return;
                        mappings[$(this).find('.mime-mime').val().toLowerCase()] = $(this).find('.mime-ext').val();
                    });
                    bg.config.setPref('mime-mappings', mappings);
                }
            }
            else if (this.id.startsWith('filetype') && this.id.endsWith('-extension')) {
                const valid = /^\w+\(|\w+\)*$/.test(this.value);
                $(this).toggleClass('is-invalid', !valid);
                // save pref
                if (valid)
                    bg.config.setPref(this.id, this.value);
            }
            else
                bg.config.setPref(this.id, this.value || null);
        }
    });

    // server-parameter delete button
    $('.server-parameter-delete')
        .on('click', function() {
            $(this).closest('.server-parameter').remove();
            $('.server-parameter:last-of-type .server-fqdn').trigger('input');
        });

    // authentication-parameter delete button
    $('.authentication-parameter-delete')
        .on('click', function() {
            $(this).closest('.authentication-parameter').remove();
            $('.authentication-parameter:last-of-type .authentication-url').trigger('input');
        });

    // customscript-parameter delete button
    $('.customscript-parameter-delete')
        .on('click', function() {
            $(this).closest('.customscript-parameter').remove();
            $('.customscript-parameter:last-of-type .customscript-url').trigger('input');
        });
    // customscript insert template
    $('.insert-scripttemplate')
        .on('click', function() {
            $(this).parent().next().children('textarea').val(bg.runcode_all_list).trigger('input');
        });

    // reset button
    $('.filetype-reset')
        .on('click', async function() {
            const i     = $('.filetype-reset').index(this) + 1,
                  label = 'filetype' + i + '-label',
                  ext   = 'filetype' + i + '-extension';

            // reset
            await Promise.all([bg.config.setPref(label, null),
                               bg.config.setPref(ext, null)]);

            await bg.config.update();
            // reload
            document.getElementById(label).value = bg.config.getPref(label);
            document.getElementById(ext).value   = bg.config.getPref(ext);
            document.getElementById(ext).classList.remove('is-invalid');
        });

    // reset button
    $('#mime-reset')
        .on('click', async function() {
            // reset
            await bg.config.setPref('mime-mappings', null);
            await bg.config.update();

            const config = bg.config.getPref();
            // clear all boxes
            $('.row.mime-mapping:not(.d-none)').remove();

            // initial mime mappings
            const mimeMappings = Object.keys(config['mime-mappings']);
            for (let key of mimeMappings) {
                let $target = $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());
                $target.find('.mime-mime').val(key);
                $target.find('.mime-ext').val(config['mime-mappings'][key]);
            }
            // empty box
            $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());
        });

    // tag insertion
    $('.tags')
        .on('click', '.tag > a[href="#"]', function(e) {
            $(e.delegateTarget).prev().children('input')[0].value += this.text;
            $(e.delegateTarget).prev().children('input').eq(0).trigger('input');
        });

    // initial location sample
    $('#download-location').trigger('input');
});

function localization()
{
    $('[data-string]').each(function() {
        $(this).text(browser.i18n.getMessage(this.dataset.string));
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
