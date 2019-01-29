/**
 * @fileOverview Download All Sources Manager content script
 * @name options.js
 * @author tukapiyo <webmaster@filewo.net>
 * @license Mozilla Public License, version 2.0
 */

// background
var bg;

const allowLocation = /^([^:,;*?"<>|]|(:(Y|M|D|h|m|s|dom|path|refdom|refpath):))*$/,
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
                let location = bg.normalizeLocation(this.value),
                    valid = allowLocation.test(location) && !denyLocation.test(location);
                $(this).toggleClass('is-invalid', !valid);
                // sample and save pref
                if (valid) {
                    $('#download-location-sample').text(bg.replaceTags(
                        location,
                        'http://www.example.com/path/name/'
                    ));
                    bg.config.setPref(this.id, location || null);
                }
                else {
                    $('#download-location-sample').text('');
                }
            }
            else
                bg.config.setPref(this.id, this.value || null);
        }
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
