/**
 * @fileOverview Download All Sources Manager content script
 * @name options.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

// background
var bg;

const allowLocation = /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|name|ext|mime|mext):))*$/,
      denyLocation  = /^[. ]+|\/[. ]+|[. ]+\/|^\/|(\.\/|\.\.\/|\/\/)/,
      allowSimultaneous = /^([1-9]|1[0-9]|2[0-4])$/,
      allowSplitCount = /^([1-9]|10)$/,
      allowMimetype = /^\S+$/,
      allowExtension= /^([A-Za-z0-9]+|[A-Za-z0-9]+(\.[A-Za-z0-9]+)+)$/;


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    localization();

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

    // initial server parameters
    const $paramTemplate = $('.row.server-parameter.d-none');
    for (let key of Object.keys(config['server-parameter'])) {
        let $target = $paramTemplate.clone().removeClass('d-none').appendTo($paramTemplate.parent());
        $target.find('.server-fqdn-punycode').val(key);
        $target.find('.server-fqdn').val(config['server-parameter'][key].fqdn);
        $target.find('.server-simultaneous').val(config['server-parameter'][key].simultaneous);
        $target.find('.server-split-count').val(config['server-parameter'][key]['split-count']);
        $target.find('.server-disable-multithread').prop('checked', config['server-parameter'][key]['disable-multithread']);
    }
    // empty box
    $paramTemplate.clone().removeClass('d-none').appendTo($paramTemplate.parent());

    // initial mime mapipngs
    const $mapTemplate = $('.row.mime-mapping.d-none');
    for (let key of Object.keys(config['mime-mappings'])) {
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
    $('input').on('input', function() {
        switch(this.type) {
        case 'checkbox':
            // server specific parameter
            if (this.classList.contains('server-parameter-box')) {
                // save pref
                if (!$('.server-parameter').find('.is-invalid').length) {
                    const parameters = {};
                    $('.server-parameter').each(function() {
                        if($(this).find('.server-fqdn').val() == '') return;
                        parameters[$(this).find('.server-fqdn-punycode').val()] = {
                            fqdn          : $(this).find('.server-fqdn').val(),
                            simultaneous  : $(this).find('.server-simultaneous').val(),
                            'split-count' : $(this).find('.server-split-count').val(),
                            'disable-multithread' : $(this).find('.server-disable-multithread').prop('checked')
                        };
                    });
                    bg.config.setPref('server-parameter', parameters);
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
                const $fqdnbox    = $(this).closest('.server-parameter').find('.server-fqdn'),
                      $punybox    = $(this).closest('.server-parameter').find('.server-fqdn-punycode'),
                      $simulbox   = $(this).closest('.server-parameter').find('.server-simultaneous'),
                      $splitbox   = $(this).closest('.server-parameter').find('.server-split-count'),
                      entered     = $fqdnbox.val() != '';

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
                        if($(this).find('.server-fqdn').val() == '') return;
                        parameters[$(this).find('.server-fqdn-punycode').val()] = {
                            fqdn          : $(this).find('.server-fqdn').val(),
                            simultaneous  : $(this).find('.server-simultaneous').val(),
                            'split-count' : $(this).find('.server-split-count').val(),
                            'disable-multithread' : $(this).find('.server-disable-multithread').prop('checked')
                        };
                    });
                    bg.config.setPref('server-parameter', parameters);
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
                        if($(this).find('.mime-mime').val() == '') return;
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

            const config = await bg.config.getPref();
            // clear all boxes
            $('.row.mime-mapping:not(.d-none)').remove();

            // initial mime mappings
            for (let key of Object.keys(config['mime-mappings'])) {
                let $target = $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());
                $target.find('.mime-mime').val(key);
                $target.find('.mime-ext').val(config['mime-mappings'][key]);
            }
            // empty box
            $mapTemplate.clone().removeClass('d-none').appendTo($mapTemplate.parent());
        });

    // tag insertion
    $('.tags')
        .on('click', 'dt > a[href="#"]', function(e) {
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
