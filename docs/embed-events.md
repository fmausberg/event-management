# Company-Veranstaltungen einbetten

Die öffentliche Übersicht unterstützt `/events/<companySlug>?embed=1`.
Im Einbettungsmodus wird kein Plattform-Menü angezeigt. Suche, Städtefilter und
Sortierung bleiben verfügbar. Eventdetails und Buchung öffnen sich in einem
neuen Tab; damit finden Login und Zahlungen außerhalb des iframe statt.

Nach dem Deployment kann die Company diesen HTML-Code in ihre Website einfügen:

```html
<iframe
  src="https://events.mausberg.net/events/event-yoga?embed=1"
  title="Veranstaltungen von Event Yoga"
  width="100%"
  height="900"
  style="border: 0; display: block;"
  loading="lazy"
></iframe>
```

`event-yoga` durch den jeweiligen Company-Slug ersetzen. Die Höhe ist anpassbar;
längere Listen scrollen innerhalb des iframe. Bei jedem neuen Laden werden die
aktuellen veröffentlichten Events abgefragt. Eine bereits geöffnete Liste
aktualisiert sich nicht automatisch im Hintergrund.

Ein iframe funktioniert ohne Plugin und ohne Zugangsdaten. Eine native
Integration per API wäre eine spätere Alternative für individuell gestaltete
Eventkarten. Für das bestehende Layout reicht die Einbettung.

Die öffentliche Company-Übersicht darf vom Reverse Proxy nicht durch
`X-Frame-Options: DENY/SAMEORIGIN` oder eine unpassende CSP `frame-ancestors`
gesperrt werden. Schutzregeln für Zahlungs- und Ticketseiten bleiben bestehen.
Ein CMS muss iframe-HTML zulassen. Falls es automatisch ein `sandbox`-Attribut
setzt, müssen Scripts, Same-Origin-Verhalten und Popups einschließlich
`allow-popups-to-escape-sandbox` für die externe Buchung erlaubt sein.

Referenz: [MDN: iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
