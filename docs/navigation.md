---
order: 4
---

# Navigation and the badge

Next.js moves between pages without reloading, so a form can mount and unmount many times in one visit. This page explains what the package does about Google's script when that happens.

## The script is loaded once per site key

Each site key's script is loaded when a field first needs it and stays after the
field unmounts. Google maintains its badge, iframes and additional scripts, so
removing the tag would leave other state behind. Fields with the same key share
the script and its promise across navigation. Different keys initialize separately.

## A layout that already loads Google

The adapter can adopt a layout's tag when its Google endpoint and `render` key match.
It waits for that element's load event before reading the API and calling `ready`.
A global from another key or a Resource Timing entry cannot confirm execution.

If the tag finishes before a field mounts, its successful load handler must set
`data-recaptcha-loaded="true"`. With Next.js `<Script>`, set the attribute from
`onLoad` or `onReady`. For an HTML script:

```html
<script
  src="https://www.google.com/recaptcha/api.js?render=YOUR_KEY"
  onload="this.setAttribute('data-recaptcha-loaded', 'true')"
></script>
```

Do not set the marker before loading succeeds.

Every attempt has a 15-second deadline, including fresh tags and `grecaptcha.ready`.
An existing tag that finished before observation without the completion marker also times out.
A load event alone is not successful initialization: tags that fail to provide the API, provide no
`ready` function, or throw while registering readiness are removed so a retry loads a fresh script.
A timed-out tag is kept, so a late load or
readiness callback is reused by the next attempt without another script or event registration.

## The badge stays visible

Because the script stays, the reCAPTCHA badge stays visible on pages without a form after the first visit to one that has a form. If you want the badge hidden, follow Google's rules for showing the reCAPTCHA branding text in your form instead of the badge.

## What this is tested against

The package is tested in a real Next.js app with Playwright: leaving a form and coming back does not load the script twice, fast navigation never leaves two scripts on the page, the back and forward buttons keep the form working, and a form submitted after navigating still reaches the server with its token.
