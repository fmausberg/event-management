# Stripe Connect: Direct Charges

Jede Company bekommt ein verbundenes Konto über Accounts v2 mit vollem Stripe-Dashboard. Stripe zieht Zahlungsgebühren beim verbundenen Konto ein (`fees_collector: stripe`); für dessen negative Salden ist Stripe zuständig (`losses_collector: stripe`). Zahlungen werden mit `stripeAccount` direkt auf diesem Konto erstellt. Es gibt keine Plattformprovision und keine Transfers über das Plattformkonto.

## Einrichtung

1. In Stripe eine Connect-Plattform einrichten, zunächst in einer Sandbox. Accounts v2 und die oben genannte Kontokonfiguration müssen für die Plattform verfügbar sein. Branding für das gehostete Onboarding konfigurieren.
2. Servervariablen setzen: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_CRON_SECRET`. `AUTH_URL` muss die öffentliche Basis-URL sein (HTTPS im Produktivbetrieb). Die vorhandenen SMTP-Variablen werden für Ticketmails verwendet; für die Ticketcodes ist zusätzlich `TICKET_CODE_ENCRYPTION_KEYS` erforderlich (siehe [Ticketcodes](ticket-codes.md)). Es wird kein öffentlicher Stripe-Schlüssel benötigt.
3. `npm ci`, `npx prisma migrate deploy`, `npm run build`. Docker übernimmt Migration und Generierung über die vorhandenen Services; die drei neuen Variablen werden in `compose.yaml` weitergegeben.
4. Einen **Snapshot-Webhook für Connected accounts** auf `https://DEINE-DOMAIN/api/webhooks/stripe` anlegen. Die API-Version auf die Version des installierten Stripe-SDK abstimmen. Folgende Events abonnieren:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `charge.refunded`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
5. Einen Job einrichten, der jede Minute `POST /api/payments/reconcile` mit Header `Authorization: Bearer <PAYMENTS_CRON_SECRET>` ausführt. Der Job prüft bis zu 50 offene Zahlungen, 50 fällige Ticketmails und 50 Trainer-Reminder sowie zusätzlich Erstattungen und Stornierungsmails; bei größerem Volumen entsprechend häufiger aufrufen. Nicht erfolgreiche Antworten überwachen und erneut versuchen. Details zu den zeitgesteuerten Mails stehen unter [Trainer-Reminder](trainer-reminders.md).
6. Als Company-Admin unter **Einstellungen → Ticketzahlungen** das Unternehmensland angeben und **Stripe einrichten** öffnen. Stripe erhebt Unternehmens-, Identitäts- und Bankdaten. Nach Rückkehr werden die aktuellen Fähigkeiten abgefragt. Bezahlen ist erst möglich, wenn Kartenzahlungen und Auszahlungen aktiv sind.

Lokal können Connect-Webhooks mit der Stripe CLI weitergeleitet werden:

```sh
stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe
```

Das von diesem Listener angezeigte Signing Secret gehört in die lokale `STRIPE_WEBHOOK_SECRET`. Test- und Live-Konten, Schlüssel und Datenbanken getrennt halten. Bestehende Stripe-Konten per OAuth anzubinden ist nicht Bestandteil dieses Onboarding-Ablaufs.

## Buchung und Zustände

### Gespeichertes Stripe-Konto nicht zugänglich

`forbidden`/`account_invalid` bzw. `not_found` beim Zugriff auf das gespeicherte
Connected Account bedeuten, dass der aktuelle API-Schlüssel das Konto nicht öffnen
kann. Prüfe die Stripe-Plattform, Test-/Live-Modus, die konkrete Sandbox und die
Schlüsselberechtigungen. Auch ein entferntes Konto kann diese Fehler verursachen.
Ein gültiger Testschlüssel allein reicht nicht: Er muss Zugriff auf genau dieses
verbundene Konto haben. Nach einer Änderung von `STRIPE_SECRET_KEY` die Anwendung
neu starten. Die Anwendung zeigt diesen Fall ausdrücklich an und ersetzt die
Kontozuordnung nicht automatisch. Vor einem Neuverbinden vorhandene Buchungen und
Payments prüfen; diese behalten ihre ursprüngliche Stripe-Kontozuordnung.

- Kostenlose Buchungen werden weiterhin sofort bestätigt. Kostenpflichtige Buchungen unterstützen zunächst **EUR, Kartenzahlungen und maximal 100 Tickets**. Der Gesamtbetrag muss zwischen 0,50 und 999.999,99 EUR liegen. Keine zusätzliche Steuerberechnung. Bei Gutscheinen erhält Stripe nur den serverseitig berechneten Restbetrag aus dem Buchungspreisnachweis. Vollständig gedeckte Buchungen benötigen keinen Stripe-Checkout. Details und Storno-Grenzen: [Gutscheine](vouchers.md).
- `PENDING_PAYMENT` reserviert Plätze in einer serialisierbaren Transaktion. Betrag, Währung, Empfängerkonto und Checkout-Parameter werden festgeschrieben. Die Checkout-Session läuft nach 35 Minuten ab.
- Alle Kapazitätsabfragen berücksichtigen auch ausstehende Zahlungen. Plätze werden **nicht allein nach der lokalen Uhr** freigegeben: Erst ein von Stripe bestätigter Ablauf setzt die Buchung auf `EXPIRED`. Das verhindert Überbuchung bei verspäteten Zahlungs-Webhooks.
- Jeder Checkout-Aufruf verwendet den gespeicherten Request und einen stabilen Idempotency-Key. Nach unsicheren Netzwerkfehlern kann derselbe Request sicher wiederholt werden. Ein lokaler Schreibfehler nach erfolgreicher Stripe-Erstellung lässt sich ebenfalls so reparieren.
- Webhooks prüfen Signatur, Account, Session, Buchungsreferenz, Betrag und Währung. Erst `status=complete` mit `payment_status=paid` erstellt gültige Tickets. Wiederholungen sind durch Transaktion, Paymentstatus und Event-ID abgesichert. Die Rückkehrseite bestätigt niemals allein anhand ihrer URL; der Button zum Prüfen liest Stripe serverseitig und verwendet dieselbe Freigabelogik.
- Die Rückkehrseite erlaubt das Fortsetzen oder Abbrechen einer offenen Zahlung. Beim Abbruch wird die Session bei Stripe beendet und erneut geprüft, bevor Plätze freigegeben werden.
- Ticketmail und Tickets werden gemeinsam gespeichert. Bearer-Links liegen bis zum Versand AES-GCM-verschlüsselt in `TicketMail`; der Schlüssel wird aus `AUTH_SECRET` abgeleitet. Nach erfolgreichem Versand wird der Inhalt gelöscht. SMTP-Ausfälle werden durch Webhook-Wiederholungen und den Abgleichjob erneut versucht. Nach einem Prozessabbruch unmittelbar nach SMTP-Zustellung ist eine doppelte Mail möglich; Tickets werden nicht doppelt erzeugt. `AUTH_SECRET` nicht wechseln, solange verschlüsselte Mails ausstehen.

## Erstattungen und Betrieb

Vollständige Erstattungen können über den [Stornierungsablauf](cancellations.md) angefordert werden. Zusätzlich werden externe Erstattungen im Stripe-Dashboard des verbundenen Kontos abgeglichen. Eine vollständige Erstattung storniert Buchung und Tickets. Eine Teilerstattung ändert den Zahlungsstatus, lässt aber die Tickets gültig; die Zuordnung einer Teilerstattung zu einzelnen Tickets wird noch nicht unterstützt. Stripe-Buchungen können im allgemeinen Buchungseditor weder geändert noch gelöscht werden.

Bestehende Buchungen werden durch die Migration nicht nachträglich belastet. Das Stornieren eines Events löst keine automatischen Erstattungen aus. Rückbuchungen/Disputes werden im Stripe-Dashboard bearbeitet; eine automatische Ticketsperre für Disputes ist nicht enthalten.

Bei Ausfällen länger als 23 Stunden werden unbekannte Sessions nicht erneut erstellt, da Stripe Idempotency-Keys später verwerfen kann. Diese Zahlungen müssen anhand ihrer `paymentId`-Metadaten im verbundenen Stripe-Konto geprüft und zugeordnet werden. Plätze bleiben bei unklarem Zustand vorsorglich reserviert. Der Abgleich meldet solche Fälle mit HTTP 503 und `failures > 0`; auch Webhook-Fehler werden mit Event-ID protokolliert. Keine Reservierung manuell freigeben, bevor ausgeschlossen ist, dass noch eine bezahlbare oder bereits bezahlte Session existiert.

## Test vor Livebetrieb

In einer Stripe-Sandbox zwei Companies onboarden. Je eine echte Checkout-Testzahlung durchführen und im jeweiligen Stripe-Dashboard prüfen, dass der richtige Account belastet wird. Danach Abbruch, Ablauf, wiederholte Webhook-Zustellung, fehlgeschlagene Karte, 3-D-Secure, volle/teilweise Erstattung und vorübergehend nicht verfügbares SMTP testen. Für knappe Kapazität zwei Käufer parallel buchen lassen: Beide aktiven Reservierungen müssen in die Kapazitätsprüfung eingehen.

Automatische Tests mocken Stripe/SMTP; sie ersetzen diesen Ende-zu-Ende-Test nicht.

Referenzen: [Direct Charges mit Checkout](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted), [Accounts-v2-Konfiguration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration), [Checkout-Freigabe](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).

Ticketmails aller Buchungsarten und Neuversand laufen gemeinsam: [Ticket-Outbox](ticket-outbox.md). Vor dem Deployment die dortige Umstellung mit angehaltenen alten Workern beachten.


Vollständige Gutschein-Stornos sind integriert: Bei Genehmigung werden Rabattlimits
und eingesetztes Wertguthaben einmalig zurückgegeben; die Stripe-Erstattung betrifft
nur den gespeicherten Restbetrag und bleibt bis zur Bestätigung offen. Externe
Teilrefunds lösen keine anteilige Gutscheinrückgabe aus. Reconciliation prüft auch
verlorene externe Refund-Ereignisse bei Gutscheinbuchungen. Ablaufdatum und
Guthabenstatus bleiben unverändert. Details, Grenzen und Prüfungen:
[Gutschein-Vollstorno](vouchers.md#14-vollstorno-und-erstattung).
