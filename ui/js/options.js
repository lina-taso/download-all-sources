/**
 * @fileOverview Download All Sources Manager content script
 * @name options.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

// background
var bg;

const allowLocation = /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath|name|ext):))*$/,
      denyLocation = /(^\/)|(\.\/|\.\.\/|\/\/)/;


$(async () => {
    bg = await browser.runtime.getBackgroundPage();
    localization();

    // input range
    $('#simultaneous-whole').on('input', function() {
        $('#simultaneous-whole-label').text(this.value);
    });
    $('#simultaneous-per-server').on('input', function() {
        $('#simultaneous-per-server-label').text(this.value);
    });

    // initial preference
    const config = await bg.config.getPref();
    $('input').each(function () {
        const id = $(this).attr('id');
        switch (this.type) {
        case 'checkbox':
            this.checked = config[id];
            break;
        default:
            this.value = config[id];
        }
    });

    $('#simultaneous-whole-label').text($('#simultaneous-whole').val());
    $('#simultaneous-per-server-label').text($('#simultaneous-per-server').val());

    // input event
    $('input').on('input', function() {
        switch(this.type) {
        case 'checkbox':
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
            if (this.id == 'download-location') {
                const location = bg.normalizeLocation(this.value),
                      valid = allowLocation.test(location) && !denyLocation.test(location);
                $(this).toggleClass('is-invalid', !valid);
                // sample and save pref
                if (valid) {
                    $('#download-location-sample').text(bg.replaceTags(
                        location,
                        'http://www.example.com/path/name/',
                        null, null, null, 'filename', 'ext'
                    ));
                    bg.config.setPref(this.id, location || null);
                }
                else {
                    $('#download-location-sample').text('');
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
            const i = $('.filetype-reset').index(this) + 1,
                  label = 'filetype' + i + '-label',
                  ext = 'filetype' + i + '-extension';
            // reset
            await Promise.all([bg.config.setPref(label, null),
                               bg.config.setPref(ext, null)]);
            // reload
            document.getElementById(label).value = await bg.config.getPref(label);
            document.getElementById(ext).value = await bg.config.getPref(ext);
            document.getElementById(ext).classList.remove('is-invalid');
        });

    // initial location sample
    $('#download-location')[0].dispatchEvent(new Event('input'));
});

function localization()
{
    $('[data-string]').each(function() {
        $(this).text(browser.i18n.getMessage(this.dataset.string));
    });
}
