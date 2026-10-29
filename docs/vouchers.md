# Gutscheine und Rabattcodes: Fachregeln und Zustandsübergänge

## Geltungsbereich und Verbindlichkeit

Dieses Dokument beschreibt Fachregeln, Datenmodell, Domänenschicht und die lokale
Integration in Buchung, Checkout, Vollstorno und administrative Gutscheinverwaltung
(Abschnitte 12–15). Verkauf von Wertgutscheinen, Teilstornos, anteilige
Gutscheinrückabwicklung und Kulanzverlängerungen sind **noch nicht implementiert**. Die lokale Migration wurde laut Einrichtung
bereits angewendet; dieser Integrationsschritt führt keine Migration aus.
Eine Produktionsfreigabe ist damit nicht verbunden.

Die mit **Festgelegt** bezeichneten Regeln bilden den verbindlichen fachlichen
Vertrag. **Empfehlung / offen (E...)** bezeichnet eine noch zu bestätigende
Standardannahme; diese ist keine bereits beschlossene Geschäftsregel. Die
Zustandsübergänge und Sicherheitsinvarianten gelten unabhängig davon, welche dieser
Optionen später gewählt wird. Die fachlichen Zustände sind inzwischen teilweise
als Prisma-Enums modelliert. Die in Abschnitten 12–15 genannten Operationen einschließlich Vollstorno und
Guthabenwiederherstellung sind implementiert.
Die verbindlichen MVP-Entscheidungen in Abschnitt 12 ersetzen frühere Empfehlungen
zu Kombination, Gästen, Mindestbetrag, Berechtigungen und Rückabwicklung.

## 1. Abgleich mit dem vorhandenen Repository

| Bereich | Vorhandenes Verhalten und Quelle |
| --- | --- |
| Beziehungen | [prisma/schema.prisma](../prisma/schema.prisma): `Event`, `EventSeries` und `Venue` gehören jeweils genau einer `Company`. `Event.eventSeriesId` und `Event.venueId` sind optional. `EventSeries.suggestedVenueId` ist eine Vorgabe, nicht das tatsächliche Venue eines Events. |
| Company-Zuordnung | [Event-Aktionen](../app/company/[companyKey]/events/actions.ts) prüfen Reihen und Venues gegen die Company des Events. [Reihen-Aktionen](../app/company/[companyKey]/event-series/actions.ts) prüfen das vorgeschlagene Venue ebenfalls gegen die Company. [Venue-Aktionen](../app/company/[companyKey]/venues/actions.ts) lesen und ändern companybezogen. Die einzelnen Fremdschlüssel im Schema erzwingen allein keine Übereinstimmung dieser Company-IDs. |
| Autorisierung | [members.ts](../lib/companies/members.ts): `requireCompanyAccess` erlaubt aktive Mitglieder einschließlich `COMPANY_USER`; `requireCompanyAdmin` verlangt für Nicht-Plattform-Admins `COMPANY_ADMIN`. Ein Plattform-`ADMIN` benötigt keine Company-Mitgliedschaft. [require-admin.ts](../lib/auth/require-admin.ts) schützt globale Admin-Zugriffe. |
| Buchung | [Öffentliche Buchungsaktion](../app/(public)/events/[companySlug]/[eventId]/actions.ts): Gastbuchung oder optionales `userId`, ein Event, 1–100 Tickets; serverseitige Prüfung von Preis, Veröffentlichung, Beginn und Kapazität. Signierter [Buchungs-Token](../lib/bookings/public-token.ts) identifiziert wiederholte Versuche. |
| Preis und Reservierung | Eventpreis ist `Decimal(10,2)`, `Payment.amount` ein Centbetrag. Die Buchungsaktion reserviert kostenpflichtige Buchungen mit `PENDING_PAYMENT` für einen Checkout mit etwa 35 Minuten Laufzeit. Bestätigte und ausstehende Buchungen belegen Plätze. Transaktionsisolation: `Serializable`. |
| Zahlung | [stripe.ts](../lib/payments/stripe.ts) erlaubt im bestehenden Zahlungsflow EUR und Beträge von 50 bis 99.999.999 Cent. [checkout.ts](../lib/payments/checkout.ts) verwendet eingefrorene Checkout-Parameter, das am Payment gespeicherte Connected Account und stabile Idempotenzschlüssel. |
| Abschluss | [fulfillment.ts](../lib/payments/fulfillment.ts) bestätigt bei aktueller Session `complete` und `paid` nach Identitäts-, Konto-, Betrags- und Währungsprüfung. Zahlung, Buchung, Tickets und initialer Mailauftrag werden gemeinsam gespeichert. |
| Webhooks / Abgleich | [Stripe-Webhook](../app/api/webhooks/stripe/route.ts) prüft die Signatur, lädt den aktuellen Stripe-Zustand und dedupliziert über `StripeWebhookEvent`. [Reconcile-Route](../app/api/payments/reconcile/route.ts) bearbeitet offene Zahlungen, Erstattungen und Mailaufträge. |
| Nullbetrag | Bei ursprünglichem Eventpreis null bestätigt die öffentliche Buchungsaktion bereits ohne `Payment`. Gutscheine oder ein nach Rabatt/Guthaben verbleibender Nullbetrag werden noch nicht berücksichtigt. |
| Stornierung | [service.ts](../lib/cancellations/service.ts) storniert bei Genehmigung Buchung und alle Tickets, während eine Stripe-Erstattung noch ausstehen kann. [refunds.ts](../lib/cancellations/refunds.ts) verarbeitet vollständige Erstattungen mit Wiederaufnahme und Idempotenz. Kunden-Selbststornierung setzt aktuell Login und `Booking.userId` voraus. |
| Teilerstattung | `applyRefund` in [fulfillment.ts](../lib/payments/fulfillment.ts) erkennt externe Teilerstattungen, erhält dabei Buchung/Tickets und setzt `PARTIALLY_REFUNDED`. Ein Ticket-Teilstorno oder dauerhaft gespeicherte einzelne Erstattungsbeträge fehlen. |
| Verwaltung / Auswertung | [Buchungsaktionen](../app/company/[companyKey]/events/[eventId]/bookings/actions.ts) schützen insbesondere Buchungen mit Payment bzw. Stornohistorie. Dieser Schutz muss später auch Gutscheinbuchungen ohne Payment erfassen. [revenue.ts](../lib/bookings/revenue.ts) wertet Stripe-Zahlungen aus und schließt Buchungen ohne Payment sowie Teilerstattungen aus. |

Die bestehenden Anleitungen [Stripe](stripe.md), [Stornierungen](cancellations.md)
und [Buchungsverwaltung](booking-management.md) beschreiben den laufenden Istzustand.
Dieses Dokument beschreibt das künftige Gutscheinverhalten und ersetzt diesen
Istzustand nicht.

## 2. Begriffe und Verantwortlichkeiten

| Begriff | Bedeutung |
| --- | --- |
| Buchung | Kaufvorgang für genau ein Event mit einer oder mehreren Personen/Tickets. Eine Buchung ist weder ein Gutscheincode noch eine einzelne Guthabenbuchung. |
| Kampagne | Gemeinsame Regeln: Art, Wert, Ziele, Zeitraum, Nutzungsgrenzen und Herkunft. Eine Rabattkampagne enthält Prozent- oder Festbetragsregeln; eine Wertgutscheinkampagne die gemeinsamen Ausgabe-/Nutzungsbedingungen für individuelle Guthaben. |
| Code | Zugang zu genau einer Kampagne. Öffentlicher Mehrfachcode oder individueller Code; eigene Sperre, Empfängerbindung und gegebenenfalls strengere Nutzungsgrenzen. Kein unabhängiger zweiter Satz von Rabattregeln. |
| Rabattcode-Einlösung | Anwendung genau eines Rabattcodes einer Rabattkampagne auf eine Buchung. Reservierung und bestätigter Verbrauch sind unterschiedliche Zustände desselben Vorgangs. |
| Wertgutschein-Einsatz | Ein bestimmter Guthabenbetrag eines Wertgutscheins, der einer Buchung zugeordnet und zunächst reserviert, dann verbraucht oder freigegeben wird. Derselbe Wertgutschein kann mehrere solche Einsätze über mehrere Buchungen besitzen. |
| Guthabenbuchung | Einzelner unveränderlicher Journaleintrag: Ausgabe, Reservierung, Verbrauch, Freigabe oder Wiederherstellung. Ein Einsatz kann mehrere Guthabenbuchungen verursachen; diese sind keine zusätzlichen Rabattcode-Einlösungen. |

**Festgelegt:** Eine Buchung verwendet höchstens eine Rabattkampagne bzw. einen
Rabattcode. Im MVP ist insgesamt genau ein Code je Gutscheinbuchung erlaubt;
Rabattcode und Wertgutschein werden nicht kombiniert. Wertguthaben ist ein
getrenntes Zahlungsmittel im fachlichen Sinne und keine Preisreduzierung.

Kampagnenregeln gelten über sämtliche zugehörigen Codes. Codes dürfen gemeinsame
Grenzen nicht erweitern. Die Quelle, etwa Influencer oder Aktion, liegt an der
Kampagne; ein Code kann zusätzlich einen Ausgabebatch oder Verteilungskanal tragen.
Jede Rabattcode-Einlösung und jeder Wertgutschein-Einsatz referenziert Buchung,
Kampagne und Code sowie die zum Zeitpunkt verwendete Quelle und Regelversion.
Reservierungen, abgeschlossene Vorgänge und Rückabwicklungen sind getrennt
auswertbar; ein Webhook zählt nicht als neue Nutzung.

## 3. Gutscheinarten und Ticketgrenzen

**Festgelegt:** Es gibt drei fachliche Arten:

| Art | Wirkung | Überhang |
| --- | --- | --- |
| Prozentualer Rabatt | Reduziert den rabattfähigen Ticketpreis um einen Prozentsatz bis einschließlich 100 %. | Kein Geldguthaben. |
| Fester Rabattbetrag in EUR | Reduziert den rabattfähigen Ticketpreis höchstens bis null. | Nicht angewendeter Rabatt wird kein Restguthaben. |
| Wertgutschein in EUR | Begleicht einen Teil oder die gesamte nach Rabatt verbleibende Forderung aus gespeichertem Guthaben. | Nicht eingesetztes Guthaben bleibt für spätere Buchungen bestehen. |

Kostenlose Teilnahme ist **keine eigene Gutscheinart**. Insbesondere werden weder
`FREE_TICKET` noch `FREE_ATTENDANCE` vorgesehen. Sie ist eine Rabattkampagne mit
100 % und einer begrenzten Anzahl rabattfähiger Tickets.

**Festgelegter Standard für Freiteilnahme:** Ein Ticket pro Rabattcode-Einlösung
ist rabattfähig. Bei drei Tickets zu je 20 EUR ergeben sich 60 EUR Originalpreis,
20 EUR Rabatt und 40 EUR verbleibende Forderung. Weitere Tickets derselben Buchung
werden normal berechnet. Eine explizit anders konfigurierte Ticketgrenze muss als
solche erkennbar sein; ein unbegrenzter 100-%-Rabatt darf nicht stillschweigend aus
der Bezeichnung „Freiteilnahme“ entstehen.

Die Ticketgrenze wirkt **je Rabattcode-Einlösung**, nicht je Guthabenbuchung und
nicht als lebenslanges Kundenkontingent. Bei Menge `q` und Grenze `k` sind
`min(q, k)` Tickets rabattfähig. Ohne Grenze sind alle Tickets rabattfähig.
Gesamtnutzungs- und Kundenlimits sind davon getrennt.

## 4. Zielauswahl und Company-Grenzen

**Festgelegt:** Jede nutzbare Kampagne hat mindestens ein konkretes Ziel.
Es gibt keinen Plattform-Gültigkeitsmodus. Eine leere Auswahl bedeutet „nirgends
gültig“ und verhindert die Aktivierung bzw. Anwendung, auch für Plattform-Admins.

| Zieltyp | Treffer für ein Event |
| --- | --- |
| Company | `Event.companyId` ist eine der ausgewählten Company-IDs. |
| Veranstaltungsreihe | Die tatsächliche `Event.eventSeriesId` ist ausgewählt. |
| Veranstaltung | Die ID des Events ist explizit ausgewählt. |
| Venue | Die tatsächliche `Event.venueId` ist ausgewählt. |

Die vier Zieltypen und die Einträge innerhalb eines Zieltyps werden per **ODER**
verknüpft. Ein Treffer genügt. Überschneidungen erzeugen weder mehrfachen Rabatt
noch mehrere Rabattcode-Einlösungen. Ein explizites Event zusätzlich zu einer
Company erweitert die Auswahl; es schränkt die Company-Auswahl nicht ein.
Es gibt in diesem Konzept keine impliziten Ausschlussziele.

Fehlt eine Reihe oder ein Venue, ist der jeweilige Vergleich falsch; andere
Treffer bleiben möglich. `EventSeries.suggestedVenueId` wird nicht als Venue des
Events behandelt. Eigentümerschaft einer Kampagne allein erzeugt keinen Treffer.
Auch nach Zieltreffer bleiben Buchbarkeit, Laufzeit, Codezustand und Limits zu prüfen.

**Festgelegt im MVP (E2):** Company-, Reihen- und Venue-Auswahl gilt dynamisch für
später neu zugeordnete Events. Entfernte Zuordnungen gelten für neue Reservierungen
nicht mehr. Einzel-Event-Auswahl bindet dagegen an die ausgewählten IDs. Bereits
reservierte Buchungen behalten ihre gespeicherten Ziele und Regeln; Änderungen
werden nicht rückwirkend angewendet. Alternative: Eine eingefrorene Eventliste
verhindert automatische Ausweitung, muss aber für neue Events gepflegt werden.

**Festgelegt:** Eine Company verwaltet Kampagnen für ihre verantworteten bzw.
zugeordneten Zielbereiche. Ziel-IDs sind serverseitig anhand der tatsächlichen
Company-Zuordnung zu autorisieren. Plattform-Admins dürfen entsprechend dem
vorhandenen Rollenmodell übergreifend verwalten. Es gibt **keine allgemeine
Company-Freigabe, kein Approval-Modell und keine Zustimmungsabhängigkeit**.

**Festgelegt im MVP (E3):** Kampagnenänderung, Codeausgabe und manuelle
Guthabenkorrekturen dürfen aktive `COMPANY_ADMIN` und aktive `COMPANY_USER`
innerhalb ihrer eigenen Company sowie globale `ADMIN` durchführen. Dafür gilt
eine ausschließlich für Gutscheine verwendete Autorisierung; andere Company-
Berechtigungen werden dadurch nicht erweitert. Staff-Zuordnung zu Event oder
Venue allein erteilt kein neues Kampagnenrecht.

Companyübergreifende Kampagnen und Wertgutscheine sind keine Voraussetzung des
ersten Umsetzungsschritts. Mehrere Ziele jedes unterstützten Typs bleiben Teil
des Fachkonzepts; ein späteres Modell darf daher Zielauswahl nicht auf ein einziges
`companyId` reduzieren. Eine Verwaltungs-Company und Ziel-Companies haben getrennte
Bedeutung. Eigentümer und gegebenenfalls Guthabenaussteller sollten von der
Gültigkeitsauswahl getrennt modellierbar bleiben.

**Offen (E4):** Die Datenbank erlaubt strukturell unterschiedliche Companies an
Event, Reihe und Venue, während die geprüften Verwaltungsaktionen dies verhindern.
Empfehlung: Bei widersprüchlichen Zuordnungen keine implizite Erweiterung der
Company-Berechtigung; den betroffenen Gutscheinversuch zur Klärung ablehnen.
Das ist eine Integritätsprüfung, kein Approval-System. Für einen späteren
companyübergreifenden Betrieb müssen Zuständigkeit und bei Wertguthaben der
finanzielle Ausgleich definiert werden. Der heutige Direct-Charge-Checkout zahlt
nur den Stripe-Restbetrag an die Event-Company und gleicht fremdes Guthaben nicht aus.

## 5. Berechnung und Preisnachweis

**Festgelegt:** Serverseitige Berechnung ist maßgeblich. Geldbeträge werden in
ganzzahligen EUR-Cent gerechnet; kein impliziter Währungswechsel. Prozentwerte
benötigen eine exakte Darstellung, beispielsweise Basispunkte (`2000 = 20 %`).
Ein Rabatt darf den rabattfähigen Betrag nicht überschreiten. Ein Guthabeneinsatz
darf weder verfügbares Guthaben noch verbleibende Forderung überschreiten.

**Festgelegte MVP-Berechnung (E5):**

1. `B = Einzelpreis × Ticketanzahl` ist der Originalgesamtpreis.
2. `R = Einzelpreis × rabattfähige Ticketanzahl` ist die Rabattbasis.
3. Prozent: `D = min(R, ROUND_HALF_UP(R × Basispunkte / 10000))`.
4. Festbetrag: `D = min(R, Festbetrag)` einmal je Buchung, nicht je Ticket.
5. Forderung nach Rabatt: `F = B − D`.
6. Wertgutschein-Einsatz: `W ≤ min(verfügbares Guthaben, F)`.
7. Stripe-Zahlbetrag: `S = F − W`. Ohne Rabatt gilt `D = 0`, ohne Guthaben `W = 0`.

Prozentbeträge werden einmal auf der Rabattbasis kaufmännisch auf Cent gerundet.
Beispiel: drei Tickets zu 9,99 EUR, 20 % auf alle Tickets: 29,97 EUR Basis,
5,99 EUR Rabatt, 23,98 EUR Forderung. Ein 10-EUR-Festrabatt auf 8 EUR Basis
reduziert um 8 EUR; die übrigen 2 EUR werden nicht gespeichert. Ein 50-EUR-Guthaben
auf 18 EUR Forderung verbraucht 18 EUR und lässt 32 EUR Guthaben übrig.

Das vorhandene `euroAmount` begrenzt positive Stripe-Beträge auf 50 bis 99.999.999
Cent. Diese Implementierungsgrenze ist bei späterer Integration erneut gegen
die tatsächliche Zahlungsanbindung zu prüfen; dieses Dokument ändert sie nicht.
Null wird gesondert behandelt und darf nicht durch eine positive Mindestbetragprüfung
abgelehnt werden. Keine automatische Erhöhung des Kundenpreises.

**Festgelegt im MVP (E6):** Falls `0 < S < 50`, die Kombination ablehnen.
Kein Resterlass und keine automatische Reduktion des Guthabeneinsatzes.
Beispiel: 10 EUR Forderung, 9,80 EUR verfügbar → 0,20 EUR Rest, daher Ablehnung.
Genau null sowie mindestens 50 Cent sind zulässig.

**Festgelegt:** An der Buchung wird ein unveränderlicher Preisnachweis benötigt:

- Event und abrechnende Company, EUR, ursprünglicher Einzelpreis, Anzahl und `B`;
- rabattfähige Anzahl und Basis, Kampagne/Code, angewendete Regelversion und `D`;
- Wertgutschein, zugeordneter Einsatz und `W`;
- verbleibender Stripe-Zahlbetrag `S` und Verknüpfung zum Payment, falls vorhanden;
- Zeitpunkt, Zieltreffer und Quellen-/Tracking-Snapshot;
- Rückabwicklungen separat, ohne die ursprünglichen Beträge zu überschreiben.

Immer gilt `B = D + W + S`. Bei E1 ohne Kombination ist mindestens `D` oder `W`
null. Ein Wertguthabeneinsatz darf in Berichten nicht als Rabatt und nicht als
erneuter Stripe-Zahlungseingang gezählt werden. Historische Preise werden nicht
nachträglich aus heutigen Eventpreisen erfunden.

**Empfehlung / offen (E7):** Für spätere Ticket-Teilstornos Preise bereits auf
stabile Ticketpositionen verteilen. Zuerst Rabatt ausschließlich auf rabattfähige
Positionen verteilen, danach Guthaben proportional zu verbleibenden Preisen.
Cent-Reste nach größten Nachkommaresten, bei Gleichstand nach stabiler
Positionsreihenfolge verteilen. Jede Positionssumme und die Gesamtsumme müssen
exakt stimmen. Keine Neuberechnung zum späteren Eventpreis. Der heutige
Checkout-Ausdruck `amount / quantity` ist bei reduzierten Beträgen nicht immer
ganzzahlig; spätere Checkout-Positionen müssen den gespeicherten Betrag exakt abbilden.

## 6. Code-Modi, Limits und Zeit

**Festgelegt:** Eine Rabattkampagne kann öffentliche Mehrfachcodes, individuelle
Codes oder beides enthalten. Alle Codes teilen dieselben Kampagnenregeln und
Kampagnenlimits. Ein Code kann zusätzlich gesperrt oder stärker begrenzt sein.

**Empfehlung / offen (E8):** Individuelle Rabattcodes sind standardmäßig einmal
erfolgreich nutzbar; öffentliche Codes mehrfach innerhalb der gemeinsamen Limits.
Wertgutscheine erhalten individuelle Codes mit eigenem Guthaben. „Individuell“
bedeutet hier ausdrücklich nicht „nur ein Einsatz“: Teileinsätze bleiben bis zur
Erschöpfung oder einem separat definierten Ablauf möglich. Ein öffentlich gemeinsam
verbrauchbares Guthaben wäre ein anderes Produkt und ist nicht vorgesehen.

| Grenze | Zähleinheit / Wirkung |
| --- | --- |
| Maximale Rabattcode-Einlösungen der Kampagne | Bestätigte, nicht gemäß Stornoregel zurückgegebene Rabattcode-Einlösungen plus offene Reservierungen über alle Codes. |
| Maximale Rabattcode-Einlösungen eines Codes | Dieselbe Zähleinheit, auf einen Code begrenzt. Ein Einmalcode darf nicht gleichzeitig in zwei Checkouts reserviert sein. |
| Rabattlimit je Kunde | Über alle Codes der Kampagne; ein Codewechsel darf das Limit nicht zurücksetzen. |
| Rabattfähige Tickets | Anzahl innerhalb einer Buchung; unabhängig von der Zahl gezählter Rabattcode-Einlösungen. |
| Guthabengrenze | Verfügbarer Geldbetrag nach Abzug aller offenen Reservierungen, kein Rabatt-Einlösungszähler. |

Ein reservierter, später freigegebener Rabattvorgang zählt nicht dauerhaft als
Verbrauch. Drei Tickets mit einem Rabattcode ergeben eine Rabattcode-Einlösung,
nicht drei. Ausgabe, Reservierung und Verbrauch desselben Wertgutschein-Einsatzes
sind mehrere Guthabenbuchungen, aber nicht mehrere Einsätze.

**Festgelegt im MVP (E9):** Auch bei Wertgutscheinen werden explizit konfigurierte
Kampagnen-, Code- und Kundenlimits berücksichtigt. Je Buchung zählt ein Einsatz,
nicht jede Journalzeile. Ohne konfigurierte Grenze beschränkt das verfügbare
Guthaben die Nutzung. Individuelle Guthabencodes erhalten anders als individuelle
Rabattcodes kein implizites Einmallimit. Ein Limit kann daher Restguthaben zeitweise
unbenutzbar machen; die spätere Verwaltung muss dies sichtbar machen.

**Empfehlung / offen (E10):** Zeiten als UTC-Zeitpunkte speichern, in Europe/Berlin
anzeigen. Kampagnenlaufzeit ist `[startsAt, endsAt)`: Start einschließlich, Ende
ausschließlich, Ende nach Start. Ein fehlendes Ende bedeutet nur dann unbefristet,
wenn dies ausdrücklich konfiguriert ist. Codezeiträume dürfen die Kampagnenlaufzeit
allenfalls verkürzen. Maßgeblich für neue Nutzung ist der Reservierungszeitpunkt,
nicht das Datum des Events. Ein zusätzlicher Eventzeitraum wäre eine eigene Regel.

Die Gesamtlaufzeit einer Kampagne, die Lebensdauer eines ausgegebenen Guthabens
und die kurze Checkout-Reservierung sind drei verschiedene Fristen. Empfehlung:
etwa 35 Minuten Reservierung wie im aktuellen Checkout. Eine rechtzeitige
Reservierung darf nach Kampagnenende innerhalb dieser Frist erfolgreich abgeschlossen
werden. Ablaufdatum des ausgegebenen Wertguthabens nicht automatisch mit dem Ende
einer Ausgabeaktion gleichsetzen; Details zu Laufzeit, nachträglicher Sperre und
wiederhergestelltem Guthaben stehen in E10/E12; für Wiederherstellung gilt im MVP
verbindlich das ursprüngliche Ablaufdatum.

**Festgelegt im MVP (E11):** Gäste dürfen Codes verwenden, auch mit Kundenlimit.
Eingeloggte Nutzer werden anhand ihrer Session-User-ID begrenzt; bei Gästen zählt
die getrimmte, kleingeschriebene Buchungs-E-Mail als weiche Grenze. Diese ist kein
verlässlicher Personenidentitätsnachweis. Wechsel der Gastadresse oder Wechsel
zwischen Gast und Konto kann die Grenze umgehen. Eine Gruppeneinlösung zählt dem
Käufer, nicht unbekannten Ticketinhabern. Empfängerbindung an einen User verlangt
das passende eingeloggte Konto. Gast-Selbststorno benötigt später einen eigenen
sicheren Zugang oder erfolgt über die Company-Verwaltung.

## 7. Reservierung und verbindlicher Abschluss

**Festgelegt:** Preisvorschau, Formularaufruf und Codeprüfung verbrauchen nichts.
Erst der verbindliche Buchungsversuch reserviert Plätze, Rabattkontingent und/oder
Guthaben gemeinsam. Eine Vorschau ist keine Garantie freier Kontingente.
Bei geänderten Konditionen wird vor einem neuen Zahlungsversuch erneut bestätigt.

### Rabattcode-Einlösung

| Ausgang | Ereignis | Ergebnis | Limitwirkung |
| --- | --- | --- | --- |
| Kein Vorgang | Gültige Buchung mit positivem Stripe-Restbetrag wird gespeichert | `RESERVED` | Kampagnen-, Code- und Kundenkontingent belegt |
| `RESERVED` | Geprüfter aktueller Stripe-Zustand bestätigt vollständige Zahlung | `COMMITTED` | Belegung wird bestätigter Verbrauch; kein zweites Zählen |
| Kein Vorgang / transiente Reservierung | Nullbetrag-Buchung wird atomar bestätigt | `COMMITTED` | Ein bestätigter Verbrauch |
| `RESERVED` | Checkout nachweislich abgelaufen oder nachweislich nicht entstanden und endgültig aufgegeben | `RELEASED` | Belegung vollständig zurückgegeben |
| `COMMITTED` | Berechtigte Rückabwicklung | Historisch rückabgewickelt (`REVERSED`) | Rückgabe des Limits nach E12; Historie bleibt |

`RELEASED` und `REVERSED` werden nicht wieder zu `RESERVED` umgeschrieben.
Ein berechtigter neuer Versuch erhält einen neuen Vorgang. Eine Wiederholung
derselben Operation gibt den vorhandenen Zustand zurück. Rabattbetrag null
verbraucht nach Empfehlung E5 keinen Code; insbesondere nicht bei ohnehin
kostenlosen Events.

### Wertgutschein-Einsatz und Guthabenjournal

Ein Einsatz durchläuft `RESERVED → COMMITTED` oder `RESERVED → RELEASED`.
Nach Verbrauch können Teilbeträge wiederhergestellt werden; der Einsatz ist dann
teilweise oder vollständig rückabgewickelt. Der ursprüngliche Verbrauch bleibt
erhalten, und die Summe wiederhergestellter Beträge darf ihn nie übersteigen.

`G` bezeichnet gebuchtes Restguthaben, `H` die Summe offener Reservierungen.
Verfügbar ist `G − H`; stets gilt `G ≥ H ≥ 0`.

| Guthabenbuchung | Änderung G | Änderung H | Voraussetzung |
| --- | --- | --- | --- |
| Ausgabe von x | +x | 0 | Eindeutiger autorisierter Ausgabevorgang; bei Verkauf bestätigte Finanzierung nach E13 |
| Reservierung von x | 0 | +x | Mindestens x verfügbar; eigener Einsatz und eindeutige Operation |
| Verbrauch von x | −x | −x | Genau diese Reservierung wird mit der Buchungsbestätigung abgeschlossen |
| Freigabe von x | 0 | −x | Genau diese offene Reservierung wird aufgegeben |
| Wiederherstellung von x | +x | 0 | Referenz auf ursprünglichen Verbrauch und autorisierte Rückabwicklung; noch nicht erstatteter Betrag mindestens x |

Jeder Eintrag erhält eine eindeutige fachliche Operationsidentität sowie Betrag,
Währung, Einsatz-/Buchungsreferenz, Zeit und Grund. Ausgabe, Freigabe und
Wiederherstellung brauchen genauso Idempotenz wie Verbrauch. Korrekturen erfolgen
über nachvollziehbare Gegenbuchungen, niemals durch Löschen oder Überschreiben
des Journals. Ein wiederholter Request erzeugt keinen weiteren Eintrag derselben
Operation. Der projizierte Saldo muss aus dem Journal rekonstruierbar sein.

Beispiel: Ausgabe 50 EUR; Buchung A reserviert 20 EUR (G=50, H=20), danach sind
30 EUR verfügbar. Bestätigung A ergibt G=30, H=0. Buchung B kann später davon
10 EUR einsetzen. Ein Timeout bei B erzeugt keine neue Ausgabe und keinen
zusätzlichen Verbrauch.

### Zusammenspiel mit Buchung, Stripe und Parallelität

**Festgelegt:**

- Bei positivem Restbetrag wird die Buchung `PENDING_PAYMENT`. Erst serverseitig
  geprüfter Zahlungserfolg und erfolgreicher Datenbankabschluss machen sie
  `CONFIRMED` und Rabattverbrauch/Guthabeneinsatz verbindlich. Eine Erfolgs-URL
  oder Browsermeldung ist kein Zahlungsnachweis.
- Bestätigung von Buchung, Rabattcode-Einlösung, Guthabenverbrauch, Ticketerzeugung
  und Ticket-Mailauftrag ist atomar. Ein Mailversandfehler nach dem Commit hebt
  die Bestätigung nicht auf.
- Bei Restbetrag null werden diese Schritte sofort atomar ausgeführt. Es entsteht
  kein unnötiger Stripe-Checkout und kein fiktives Payment. Fehlende Stripe-Freigabe
  darf eine vollständig durch Rabatt oder Guthaben gedeckte Buchung nicht blockieren.
- Schließen des Browsers, Aufruf der Cancel-URL, Netzwerkfehler und das bloße
  Überschreiten von `reservedUntil` beweisen keinen erfolglosen Checkout. Solange
  Zahlung möglich oder unklar ist, bleiben die zugehörigen Ressourcen reserviert.
- Freigabe erfolgt nach bestätigtem Stripe-Ablauf bzw. nach sicherem Nachweis,
  dass kein Checkout erstellt wurde und der Versuch beendet ist. Für einen aktiven
  Abbruch muss zuerst die Zahlbarkeit der Session sicher beendet und ihr aktueller
  Zustand geprüft werden. Das Abbruch- und Erfolgsrennen darf nur einen Ausgang haben.
- Webhook, Rückkehrseite und Hintergrundabgleich verwenden dieselben fachlichen
  Übergänge. Derselbe Erfolg unter verschiedenen Webhook-IDs darf nicht doppelt
  verbrauchen. Ein spätes Ablaufereignis darf bestätigte Buchungen nicht zurücksetzen.
- Wiederholte Buchungsrequests übernehmen den bestehenden eingefrorenen Preis und
  Vorgang. Veränderte Menge, Identität oder Codes dürfen einen laufenden Checkout
  nicht umschreiben. Erst sicher beenden und danach einen neuen Versuch anlegen.
- Gleichzeitige Checkouts dürfen gemeinsam weder Kapazität noch Kampagnen-, Code-,
  Kundenlimits oder Guthaben überschreiten. Prüfung und Reservierung bilden eine
  Transaktion; ein ungeschütztes Lesen und späteres Schreiben genügt nicht.
- Spätere technische Umsetzung: Datenbank-Constraints, atomare Zustandswechsel
  und begrenzte Wiederholungen bei Serialisierungskonflikten. Netzwerkaufrufe zu
  Stripe erfolgen außerhalb der Datenbanktransaktion. Dauerhafte Vorgangsidentität
  ermöglicht Wiederaufnahme nach einem Prozessabbruch zwischen Datenbank und Stripe.
- Nicht automatisch auflösbare Zahlungszustände bleiben zur Prüfung offen.
  Keine Freigabe allein zur Auflösung eines lange bestehenden Guthaben-Holds.

## 8. Stornierung und Erstattung

**Festgelegt:** Eine Stornoanfrage allein ändert weder Rabattverbrauch noch Guthaben.
Ablehnung oder Rücknahme ebenfalls nicht. Plätze/Tickets, Rabattlimit,
Guthabenwiederherstellung und Stripe-Erstattung sind getrennte Auswirkungen eines
nachvollziehbaren Rückabwicklungsvorgangs. Der Status „storniert“ bedeutet nicht
automatisch „Stripe-Erstattung erfolgreich“.

| Fall | Rabatt / Limits | Wertguthaben | Stripe |
| --- | --- | --- | --- |
| Nicht abgeschlossener Checkout, sicher beendet | Reservierung freigeben | Reservierung freigeben, kein Wiederherstellungs-Eintrag für nie verbrauchtes Geld | Keine Erstattung ohne Zahlung |
| Vollständige genehmigte Stornierung | Rabatt nie auszahlen; Limitrückgabe nach E12 | Verbrauch bis zur noch nicht zurückgegebenen Höhe wiederherstellen | Nur tatsächlich gezahlten, noch nicht erstatteten Stripe-Anteil erstatten |
| Teilstorno bestimmter Tickets | Rabatt gemäß ursprünglicher Positionsverteilung; keine Neuberechnung auf verbleibende Tickets | Nur den diesen Positionen zugewiesenen Guthabenanteil wiederherstellen | Nur deren ursprünglich gezahlten Stripe-Anteil erstatten |
| Externe teilweise Stripe-Erstattung ohne Ticketbezug | Keine automatische Limitrückgabe | Keine automatische Guthabenwiederherstellung | Betrag/Identität erfassen; fachliche Zuordnung zur Prüfung |
| Externe vollständige Stripe-Erstattung | Vorhandener Code storniert Buchung/Tickets; spätere Gutscheinlogik muss denselben einmaligen Rückabwicklungsvorgang nutzen | Keine zweite Wiederherstellung, falls bereits durch Storno erfolgt | Bestätigte externe Erstattung übernehmen, nicht erneut auslösen |

**Festgelegt für die spätere MVP-Integration (E12):** Bei vollständiger genehmigter Stornierung
Rabatt-Kampagnen-, Code- und Kundenlimit einmal zurückgeben. Bei Teilstorno bleibt
die Rabattcode-Einlösung gezählt; erst die vollständige Rückabwicklung gibt den
Zähler zurück. Die Limitrückgabe ist getrennt vom Eurobetrag zu speichern.

Festlegung für die spätere Integration E12: Guthaben bei genehmigtem Storno zusammen mit der lokalen
Rückabwicklung wiederherstellen, unabhängig vom noch ausstehenden Stripe-Erfolg.
Die Kundenanzeige unterscheidet „Guthaben zurückgegeben“ und „Geld-Erstattung
ausstehend“. Stripe-Fehler lösen keine zweite Guthabenwiederherstellung aus.
Extern bestätigte Vollerstattungen führen über denselben idempotenten Vorgang;
bereits erfolgte lokale Teil- oder Vollrückgaben werden berücksichtigt.

Empfehlung E7: Teilstornos zunächst nicht öffentlich anbieten, da der bestehende
Flow nur Vollstorno unterstützt. Die obige Positionsregel ist Grundlage für die
spätere Erweiterung. Ohne belastbare Positionszuordnung keine automatische
Guthabenrückgabe bei einer Teilerstattung. Auch nach externer Teilerstattung müssen
spätere Erstattungen insgesamt durch den ursprünglichen Stripe- und Guthabenanteil
jeweils begrenzt bleiben; offene Erstattungsaufträge sind mit zu berücksichtigen.

Festgelegt E12: Wiederhergestelltes Guthaben behält seine ursprüngliche Gültigkeit.
Eine Verlängerung benötigt einen getrennten protokollierten Kulanzvorgang; sie
geschieht nicht automatisch. Eine Auszahlung
von Wertguthaben anstelle Wiederherstellung ist nicht automatisch zulässig und
nicht Bestandteil dieses Konzepts.

Eine Eventabsage ist im bestehenden Code zunächst eine Änderung des Eventstatus.
Sie darf nicht als bereits implementierte Sammelstornierung oder Rückzahlung
beschrieben werden. Empfehlung E14: nötige Rückabwicklungen später je betroffener
Buchung nachvollziehbar und idempotent durchführen.

## 9. Entscheidungsstand vor den jeweils betroffenen Umsetzungsschritten

Die verbindlichen MVP-Festlegungen in Abschnitt 12 haben Vorrang. Die folgenden
Einträge unterscheiden entschiedene Regeln von weiterhin offenen Erweiterungen.

| ID | Entscheidung | Empfohlener Standard und Auswirkung |
| --- | --- | --- |
| E1 | Kombination | Im MVP entschieden: insgesamt ein Code pro Gutscheinbuchung, keine Kombination. Erweiterungen sind nicht freigegeben. |
| E2 | Dynamische Ziele? | Neue Zuordnungen erfassen, entfernte Zuordnungen für neue Versuche ausschließen; bestehende Reservierungen einfrieren. Alternative: feste Eventliste. |
| E3 | Darf `COMPANY_USER` Gutscheine verwalten? | Im MVP entschieden: ja; aktive `COMPANY_USER` und `COMPANY_ADMIN` dürfen Gutscheine ausschließlich in ihrer eigenen Company verwalten. Globale `ADMIN` behalten ihre übergreifenden Rechte. |
| E4 | Inkonsistente Company-Beziehungen / spätere übergreifende Nutzung? | Inkonsistenzen ablehnen und klären; initial companybezogene Nutzung. Übergreifende Zielverwaltung und Guthabenausgleich separat spezifizieren, ohne Approval-System. |
| E5 | Festbetrag, Rundung, weitere Ticketgrenzen und Null-Effekt? | Festbetrag je Buchung, Prozent auf Gesamtrabattbasis einmal HALF_UP, bei gewöhnlichen Rabatten alle Tickets sofern nicht begrenzt, Null-Effekt verbraucht keinen Code. Freiteilnahme hat festgelegten Standard ein Ticket. |
| E6 | Restbetrag 1–49 Cent? | Im MVP entschieden: ablehnen, weder Resterlass noch automatische Einsatzreduktion. |
| E7 | Teilstorno und Preisverteilung? | Positionsverteilung wie oben vorbereiten; zunächst Vollstorno anbieten. Keine automatische Interpretation externer Teilrefunds. |
| E8 | Individuelle Rabattcodes / Guthabencodes? | Rabattcodes standardmäßig einmal nutzbar; Guthabencodes mehrfach bis zur verfügbaren Deckung. Öffentlicher gemeinsamer Guthabentopf ausgeschlossen, solange nicht separat beauftragt. |
| E9 | Zusätzliche Wertgutschein-Limits? | Im MVP entschieden: explizite Kampagnen-/Code-/Kundenlimits zählen Einsätze je Buchung; kein implizites Einmallimit für Wertgutscheine. Ein Ausgabebudget bleibt separat offen. |
| E10 | Laufzeiten, Sperren und Abschluss nach Kampagnenende? | UTC, Start inklusiv/Ende exklusiv; rechtzeitige Reservierungen innerhalb Checkout-Frist erfüllen. Ausgegebenes Guthaben hat eine eigene explizite Laufzeit. Eine pausierte Ausgabeaktion entwertet nicht automatisch bestehendes Guthaben. |
| E11 | Kundenidentität, Gäste und Übertragbarkeit? | Im MVP: Session-User-ID bzw. normalisierte Gast-E-Mail als weiche Grenze. Empfängerbindung erzwingen. Sicherer Gast-Stornozugang bleibt offen. |
| E12 | Limitrückgabe, Zeitpunkt und Gültigkeit der Guthabenrückgabe? | Für spätere Integration entschieden: Vollstorno gibt Rabattlimits zurück und stellt Guthaben einmalig mit ursprünglicher Gültigkeit wieder her. Stripe-Erfolg separat verfolgen. Keine Teilstornos. |
| E13 | Verkauf oder kostenlose Ausgabe von Wertgutscheinen? | Herkunft und Finanzierung speichern. Kostenlos ausgegebene und verkaufte Werte unterscheiden; bei Verkauf Guthaben erst nach bestätigter Zahlung ausgeben. Ein eigener Verkaufs-/Ausgabeflow ist ein späterer Auftrag. |
| E14 | Eventabsage und bestehende Buchungen? | Keine stillschweigende Sammelrückzahlung behaupten. Spätere Verarbeitung je Buchung über denselben Rückabwicklungsweg. |

## 10. Grundlage für die spätere Umsetzung

Das spätere Datenmodell muss Kampagne, Code, Rabattcode-Einlösung,
Wertgutschein-Einsatz, Guthabenkonto und Guthabenjournal unterscheidbar halten.
Eine gemeinsame technische Vorgangstabelle ist nur dann vertretbar, wenn Typ,
Zähleinheit, Beträge und Zustände eindeutig bleiben. Zielrelationen müssen mehrere
konkrete IDs je Zieltyp erlauben. Weder ein Freiteilnahme-Typ noch eine
Company-Approval-Entität gehören in diesen Entwurf.

Unveränderlicher Preisnachweis, Code-/Kampagnenreferenzen, eindeutige
Operationsidentitäten und historische Rückabwicklungen sind Voraussetzung für
Nachvollziehbarkeit. Auch kostenlose Gutscheinbuchungen ohne Payment müssen später
vor direkter Mengenänderung, Löschung oder Statusüberschreibung außerhalb dieser
Fachlogik geschützt werden.

Fachliche Abnahmeszenarien für spätere Implementierung:

- Ein Ticket gratis bei drei gebuchten Tickets lässt zwei Tickets kostenpflichtig.
- Company, Reihe und Venue treffen gleichzeitig: genau ein Rabatt und ein Zähler.
- Leere Ziele: keine Nutzung; fehlendes Venue verhindert einen anderen Zieltreffer nicht.
- Zwei parallele Checkouts auf den letzten Codeplatz: höchstens einer reserviert.
- Zwei parallele Einsätze eines 50-EUR-Guthabens reservieren zusammen höchstens 50 EUR.
- Doppelte Requests und unterschiedliche Webhooks desselben Erfolgs verbrauchen einmal.
- Browserabbruch bei unklarem Zahlungsstatus gibt kein Guthaben vorzeitig frei.
- Vollständig mit Guthaben gedeckte Buchung bestätigt ohne Stripe und bleibt stornierbar.
- Storno und externer Refund desselben Vorgangs geben Guthaben und Limits höchstens einmal zurück.
- Teilerstattungen überschreiten weder den ursprünglichen Geld- noch Guthabenanteil.

Diese Szenarien sind Anforderungen, keine ausgeführten Tests. Die Datenmodellierung
ist in Abschnitt 11 konkretisiert; Funktionen folgen in gesonderten Schritten.

## 11. Angelegtes Datenmodell und Grenzen der Migration

Die Migration `20261029120000_voucher_data_model` legt ausschließlich neue Typen,
Tabellen, Indizes, Fremdschlüssel, CHECK-Constraints und Änderungsschutz-Trigger an.
Sie enthält keinen Backfill und keine Änderung bestehender Buchungs-, Payment-
oder Stornodatensätze. Sie wurde für diesen Schritt nur als SQL-Datei erzeugt,
nicht auf einer Datenbank ausgeführt.

| Modell | Konkretisierung |
| --- | --- |
| `VoucherCampaign` | Art `PERCENTAGE`, `FIXED_AMOUNT` oder `STORED_VALUE`; Wert, Basispunkte, Zeitraum, Limits, Ticketgrenze, Quelle, Eigentümer-Company und Ersteller. Status `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`. `amountMinor` ist bei Wertgutscheinen der Ausgabewert pro Guthaben, kein gemeinsamer Kampagnentopf. |
| Vier `VoucherCampaign...`-Zielmodelle | Zusammengesetzter Primärschlüssel aus Kampagne und Ziel, echte Fremdschlüssel zu Company, EventSeries, Event und Venue. `ownerCompanyId` ist keine automatische Gültigkeit. Kein Approval-Modell. |
| `VoucherCode` | Öffentlicher oder individueller Code, Status, optionaler Zeitraum, Limit, Empfänger-User, Quelle und Batch. Nur eindeutiger `codeDigest`, `digestVersion` und optional höchstens vier Endzeichen; kein vollständiger Code im Klartext. |
| `VoucherRedemption` | Ausschließlich Rabattcode-Einlösung. Eindeutiges `bookingId` erzwingt höchstens eine solche Einlösung je Buchung, auch historisch. Neue Versuche nach Freigabe benötigen deshalb eine neue Buchung. Kampagne/Code, User, Request-Schlüssel, Status, Rabattbasis, Ticketanzahl und Regel-/Ziel-/Quellen-Snapshots bleiben nachvollziehbar. |
| `VoucherBalance` | Eigenes Guthaben je Code, Aussteller-Company, Ausgabewert, separate Ablaufzeit und Ausgabeherkunft. `balanceMinor` und `reservedMinor` sind Journalprojektionen; ein neuer Datensatz allein erzeugt noch kein Guthaben. |
| `VoucherBalanceUse` | Zusätzliches Modell für Wertgutschein-Einsätze, getrennt von Rabattcode-Einlösungen. Mehrere Buchungen je Guthaben; höchstens ein Einsatz desselben Guthabens je Buchung. Es bleibt strukturell erweiterbar für mehrere unterschiedliche Guthaben, ohne E1 damit fachlich zu entscheiden. |
| `VoucherBalanceEntry` | Unveränderliches Journal mit Typ, Betrag, Saldo-/Reservierungsänderung, eindeutigem Operationsschlüssel, Grund und optionalem Akteur. Einsatz referenziert seine Buchung; `reversalOfId` referenziert den ursprünglichen Journaleintrag. |
| `BookingPrice` | Optionaler 1:1-Preisnachweis an Booking, unveränderlich nach Anlage; Event, Company, Einzelpreis, Menge, Originalbetrag, Rabatt, Guthabenbetrag, Restbetrag, EUR und Berechnungsversion. Optionaler Positions-Snapshot bereitet E7 vor. Altbuchungen bleiben ohne Preisnachweis. |

Die zehn vorgeschlagenen Modellnamen wurden beibehalten; `VoucherBalanceUse`
ergänzt die im Konzept ausdrücklich getrennte Bedeutung eines Guthabeneinsatzes.
Alle Geldwerte sind `Int` wie `Payment.amount`; die späteren Berechnungen müssen
den PostgreSQL-Integerbereich und die Zahlungsgrenzen vor dem Speichern prüfen.
Prozentwerte sind ganzzahlige Basispunkte. Es gibt keinen Freiteilnahme-Enumwert.

Technische Entscheidungen und Datenbankgarantien:

- Alle neuen Relationen verwenden `onDelete: Restrict`. Company, Kampagne, Code,
  User oder Buchung können damit keine verknüpfte Finanzhistorie kaskadierend löschen.
  Finanzielle Historie verlangt Archivierung/Deaktivierung; auch die Löschung
  referenzierter Benutzer bleibt bis zu einer gesonderten Aufbewahrungs-/
  Anonymisierungslösung gesperrt.
- Zusammengesetzte Fremdschlüssel sichern die Kette Kampagne–Code–Guthaben–Einsatz
  und die Zugehörigkeit von Journal/Gegenbuchung zum gleichen Guthaben ab.
- Unique-Schlüssel sichern Request-/Operationsidentitäten. Zusätzliche partielle
  SQL-Indizes erlauben je Guthaben nur eine Ausgabe sowie je Einsatz nur eine
  Reservierung und entweder Verbrauch oder Freigabe, nicht beides. Teilweise
  Wiederherstellungen bleiben mit unterschiedlichen fachlichen Operationsschlüsseln
  möglich. Ein wiederholtes externes Ereignis muss denselben Schlüssel verwenden.
- CHECKs prüfen Art/Wert-Kombinationen, positive Limits, Zeitreihenfolge, EUR,
  nicht negative Salden, Reservierung höchstens in Guthabenhöhe, Rückgabe höchstens
  in Einsatzhöhe und typgerechte Journal-Deltas. Preisnachweise erfüllen
  `Originalbetrag = Einzelpreis × Menge = Rabatt + Guthaben + Restbetrag`.
- SQL-Trigger verhindern UPDATE, DELETE und TRUNCATE von `VoucherBalanceEntry`
  und `BookingPrice`. Korrekturen des Guthabens werden als neue `ADJUST`-Einträge
  mit Akteur/Grund und signierter Saldoänderung erfasst; sie ändern nicht still
  die Reservierungen. Ein falscher Preisnachweis darf nicht überschrieben werden:
  Versuch sicher beenden und eine neue Buchung mit neuem Snapshot anlegen.
- SQL-CHECKs, partielle Indizes und Trigger sind nicht vollständig im Prisma-Modell
  darstellbar. Sie müssen in künftigen Migrationen ausdrücklich erhalten bleiben.
  Die Migration enthält keine automatische Journalverbuchung oder Preisberechnung.
- `limitReturnedAt` ist unabhängig vom Rückabwicklungsstatus gespeichert. Das Modell
  könnte Kontingente nach Rückabwicklung behalten; der MVP verlangt bei Vollstorno
  ausdrücklich die Rückgabe. Reservierungen und `COMMITTED` zählen; `REVERSED`
  zählt weiter, solange `limitReturnedAt` fehlt; `RELEASED` zählt nicht.

Noch serverseitig und transaktional durchzusetzen (nicht durch diese Migration):

- Aktivierung nur mit mindestens einem Ziel; auch das Entfernen des letzten Ziels
  einer aktiven Kampagne muss geschützt werden. Ein einfacher CHECK kann die vier
  Zieltabellen nicht zuverlässig prüfen. Es werden dafür keine Aktivierungs-Trigger
  eingeführt; `DRAFT` ist der Standard, die spätere Aktivierungsvalidierung ist Pflicht.
- Company-Autorisierung, ODER-Zieltreffer, widersprüchliche Event-Zuordnungen,
  Codezeiträume innerhalb der Kampagnenlaufzeit sowie Art-Kompatibilität:
  Rabattcode-Einlösungen nur für Rabattkampagnen, Guthaben nur für individuelle
  Codes einer Wertgutscheinkampagne. Die Fremdschlüssel allein prüfen keine Arten.
- Kampagnen-/Code-/Kundenlimits, Zieländerungen, Lebenszyklusübergänge und
  Journalprojektionen unter Parallelität atomar prüfen und fortschreiben.
  CHECKs für einzelne Zeilen ersetzen keine gesperrte bzw. serialisierbare
  Transaktion über Guthaben, Einsätze und Journal.
- `RESTORE` muss den `SPEND` desselben Einsatzes referenzieren; Summe aller
  Wiederherstellungen und `restoredMinor` müssen übereinstimmen. Auch die Zuordnung
  einer Stornoanfrage zur Buchung des Einsatzes sowie die Übereinstimmung von
  BookingPrice, Buchung, Rabatt, Guthabeneinsätzen und Payment sind zu prüfen.
- JSON-Regel-, Ziel-, Quellen- und Positions-Snapshots benötigen versionierte
  Validierung; sie dürfen keine vollständigen Codes enthalten. Bestehende
  Einlösungs-Snapshots dürfen bei Statuswechseln nicht umgeschrieben werden.
- Code-Normalisierung und Digest-Erzeugung sind inzwischen implementiert (Abschnitt 12).
  Vorgesehen ist ein versionierter keyed Digest; sichere Schlüsselhaltung,
  Normalisierung und Rotation einschließlich Eindeutigkeit über Digest-Versionen
  müssen vor der Codeausgabe festgelegt werden. Ein Unique-Digest allein verhindert
  nicht dieselbe Zeichenfolge unter unterschiedlichen Digest-Schlüsseln.

Erstattungsbezug ohne Änderung bestehender Abläufe: Ein Journaleintrag kann
`cancellationRequestId` als echten Fremdschlüssel und `externalRefundId` als externe
Referenz tragen. Seine Buchung ergibt sich aus `VoucherBalanceUse.bookingId`.
Mehrere Teilrückgaben können denselben externen Refund betreffen; die Idempotenz
liegt deshalb an der fachlichen Operation, nicht allein an der Stripe-ID.
Es werden keine neuen Pflichtfelder am bestehenden `CancellationRequest` oder
`Payment` eingeführt; der Prisma-Rückverweis benötigt keine Änderung ihrer Tabellen.

**Bestehende Integrationslücke:** Die Erstattungslogik verarbeitet weiterhin nur
den vollständigen `Payment.amount` und schreibt kein Gutscheinjournal. Auch die
heutigen manuellen Buchungsaktionen erkennen die neuen Relationen noch nicht als
Änderungsschutz. Der spätere Schritt muss diese Pfade sowie externe Teilrefunds,
Nullbetrag-Buchungen und Guthabenwiederherstellung gemeinsam integrieren. Bis dahin
darf das Datenmodell nicht als betriebsbereite Gutscheinfunktion verstanden werden.
Die Entscheidungen E1–E14 bleiben offen, soweit sie auch nach den MVP-Festlegungen
in Abschnitt 12 noch als offen bezeichnet sind;
das optionale Kampagnenfeld `policy` nimmt spätere explizite Entscheidungen auf,
ohne sie jetzt durch Defaults vorwegzunehmen.

## 12. Serverseitige MVP-Domänenschicht

Die Funktionen unter `lib/vouchers/` sind `server-only`, keine Server Actions
und keine öffentlichen Endpunkte. Sie sind noch an keinen Buchungs-, Stripe-,
Webhook- oder Stornoablauf angeschlossen. Es wurde keine Migration angewendet.

| Datei / Funktion | Verhalten |
| --- | --- |
| `config.ts`: `getVoucherDigestKeyring` | Zentrale, bedarfsabhängige Validierung der serverseitigen Schlüsselkonfiguration. Ungültige Konfiguration erzeugt `VoucherConfigurationError` ohne Werte oder ursprüngliche Parser-Exception; öffentliche Ergebnisse bleiben generisch `UNAVAILABLE`. |
| `codes.ts`: `normalizeVoucherCode`, `voucherCodeDigests`, `voucherCodeDigest` | ASCII-Codes mit 4–128 Zeichen, außen trimmen, Großschreibung, Bindestrich/Unterstrich erhalten. HMAC-SHA256 mit Version und Domain-Präfix; alle aufbewahrten Schlüssel beim Lookup prüfen. Mehrdeutige Treffer über Schlüsselversionen werden abgelehnt. |
| `eligibility.ts`: `assertVoucherEligible`, `voucherTargetMatches` | Status, Zeitraum, Empfängerbindung und dynamische ODER-Ziele prüfen; fehlende Zuordnung ist kein Treffer. Widersprüchliche Event-/Company-Zuordnungen werden abgelehnt. Guthaben nur bei individuellem Code und Event der ausstellenden Company. |
| `pricing.ts`: `calculateVoucherPrice` | Exakte Centrechnung, Basispunkte, HALF_UP auf Rabattgesamtbetrag, fester Rabatt einmal, 100 % standardmäßig auf ein Ticket. Wertguthaben nur bis zur Forderung, ohne Kombination; Rest 1–49 Cent ablehnen. `requiresCheckout=false` bei null. |
| `service.ts`: `quoteVoucher` | Read-only-Preisvorschau aus aktuellem Eventpreis. Prüfung von Limits ist unverbindlich und reserviert nichts. Nur Preisfelder bzw. sichere Fehler werden zurückgegeben. |
| `service.ts`: `withVoucherTransaction` | Interne Kompositionsgrenze: bietet der späteren Buchungsintegration `tx` und `reserve(input)` innerhalb einer serialisierbaren Transaktion. Reserviert Rabatt bzw. Guthaben und schreibt den unveränderlichen `BookingPrice`. |
| `service.ts`: `releaseExpiredVoucherReservation` | Interner Worker-Helfer: gibt ausschließlich offene Reservierungen einer bereits `EXPIRED` gespeicherten Buchung frei; vorhandenes Payment muss ebenfalls `EXPIRED` sein. Keine Stripe-Aufrufe, kein selbstständiges Setzen des Ablaufstatus. |
| `authorization.ts`: `requireVoucherCampaignAdmin` | Aktuelle DB-Rolle und aktive Mitgliedschaft prüfen. Aktive `COMPANY_ADMIN` und `COMPANY_USER` der Eigentümer-Company sowie Plattform-Admins sind zugelassen. |
| `errors.ts` | Stabile Fehlercodes und deutsche Meldungen, ohne übernommene Exceptions, Prisma-Metadaten, Klartextcodes oder Schlüsselmaterial. |

### Schlüssel und Geheimnisse

`VOUCHER_CODE_DIGEST_KEYS` wird wie der vorhandene Ticket-Schlüsselring als
JSON-Konfiguration bereitgestellt, mit numerischem `active` und einem `keys`-Objekt:
`{"active":1,"keys":{"1":"<Base64 eines zufälligen 32-Byte-Schlüssels>"}}`.
Keine echten Schlüssel einchecken; dies ist eine neue, nicht vorab konfigurierte
Umgebungsvariable. Es gibt keinen Fallback auf AUTH_SECRET. Alte Schlüssel werden
für bestehende Codes behalten. Fehler enthalten niemals eingegebene Codes.

Das Format bleibt unverändert: `active` ist eine JSON-Zahl von 1 bis 2147483647
und muss in `keys` vorhanden sein. `keys` enthält 1–10 Einträge; deren Namen sind
positive Ganzzahlen ohne führende Nullen im selben Bereich. Jeder Wert muss
kanonisches Standard-Base64 für genau 32 Bytes sein (44 Zeichen einschließlich
abschließendem `=`), kein Base64url, Hex oder frei gewähltes Passwort.
Der Parser kann Länge und Kodierung prüfen, nicht die Zufälligkeit des Materials.

#### Lokale Einrichtung

Im Projektroot `.env.example` als Vorlage für die ignorierte `.env.local` nutzen;
es gibt keine separate `.env.local.example`. In einer bereits vorhandenen Datei
nur die neue Variable ergänzen, die übrige Konfiguration nicht überschreiben.
Next.js lädt die lokale Datei in `process.env`; bereits gesetzte Prozessvariablen
haben Vorrang. Nach einer Änderung den lokalen App-Prozess neu starten.

Unter Windows/PowerShell erzeugt der folgende Befehl einen vollständigen Keyring
und kopiert ihn direkt in die Zwischenablage, ohne ihn im Terminal auszugeben:

```powershell
node -e "process.stdout.write(JSON.stringify({active:1,keys:{1:require('node:crypto').randomBytes(32).toString('base64')}}))" | Set-Clipboard
```

Den Inhalt nur lokal im Editor zwischen die einfachen Anführungszeichen einsetzen:

```dotenv
VOUCHER_CODE_DIGEST_KEYS='<JSON_AUS_DER_ZWISCHENABLAGE>'
```

Die Platzhalter in diesem Dokument sowie `.env.example` und `.env.docker.example`
sind absichtlich ungültig und enthalten keine Schlüssel. Den erzeugten Inhalt
nicht in Chat, Git, Tickets oder Logs kopieren. Danach die Zwischenablage leeren
(`Set-Clipboard -Value ''`); bei aktivierter Zwischenablagehistorie/Synchronisierung
den Eintrag dort ebenfalls entfernen. `.env.local` und `.env.docker` sind durch
`.gitignore` ausgeschlossen; nicht mit `git add -f` aufnehmen.

Für Docker gehört der Keyring in die separat verwaltete `.env.docker` und wird
von `compose.yaml` an den App-Container übergeben. Keine Schlüssel als
Docker-Build-Argument, `NEXT_PUBLIC_`-Variable oder GitHub-Workflow-Literal verwenden.
Konfiguration für Entwicklung, Test/Staging und Produktion getrennt erzeugen;
auch AUTH_SECRET und Ticket-Verschlüsselungsschlüssel nicht wiederverwenden.

#### Rotation

Neue zufällige 32 Bytes unter einer neuen, noch nicht verwendeten Versionsnummer
ergänzen. Bestehende Versionsnummern und Schlüsselwerte unverändert behalten:
Beides fließt in den HMAC ein. Zunächst alle App-Instanzen mit dem erweiterten
Schlüsselring versorgen, anschließend `active` auf die neue Version setzen.
`voucherCodeDigest` verwendet die aktive Version für neue Digests;
`voucherCodeDigests` prüft weiterhin sämtliche aufbewahrten Versionen beim Lookup.

Alte Schlüssel erst entfernen, wenn keine damit gespeicherten Codes mehr benötigt
werden. Aus einem Digest lässt sich ohne Originalcode kein Digest unter einem
neuen Schlüssel erzeugen; es gibt keine automatische Umschlüsselung. Der Ring
unterstützt höchstens zehn Versionen. Vor Erreichen dieser Grenze muss der
Lebenszyklus alter Codes geklärt werden, statt benötigte Schlüssel zu löschen.

Der spätere Codeausgabeflow muss vor Ausgabe auf alle Schlüsselversionen prüfen;
die jetzt implementierte aktive Digest-Erzeugung allein garantiert keine globale
Eindeutigkeit über Rotationen. Lookup lehnt doppelte Zuordnungen sicher ab.
Weder Codes noch Tokens dürfen später durch Request-Logging/Telemetrie der
Integrationsschicht protokolliert werden. Die Domänenschicht selbst loggt nicht.

### Transaktionen, Identität und Wiederholung

Ein Gutschein-Aufruf erhält genau einen Code. Vor `reserve` legt der vertrauenswürdige
Aufrufer die `PENDING_PAYMENT`-Buchung und deren Reservierungsfrist innerhalb
derselben `withVoucherTransaction`-Transaktion an. Der Helfer erzeugt keine Buchung
und prüft keine Sitzplatzkapazität. Kapazitätsprüfung und Buchung gehören in die
aufrufende Transaktion, danach folgen Gutscheinreservierung und ggf. Paymentanlage.
Noch kein Stripe-/SMTP-Aufruf innerhalb des Callbacks. Fehler dürfen dort nicht
abgefangen und in einen erfolgreichen Commit umgewandelt werden.

`reserve` prüft den vorhandenen signierten Buchungs-Token mit dessen Buchungs-ID,
Event und Originalpreis. Menge, eingeloggter Nutzer bzw. Gast-E-Mail und Code werden
gegen die gespeicherte Buchung/Einlösung geprüft. Derselbe Token mit verändertem
Event, Menge oder Code wird abgelehnt. Ein bestehender Checkout oder eine Altbuchung
wird nicht nachträglich rabattiert. Ein unveränderter Versuch liefert seinen
gespeicherten Preis zurück, auch wenn die Kampagne inzwischen pausiert wurde.
Abgelaufene/stornierte Versuche werden nicht reaktiviert.

Sperrreihenfolge ist Buchung, Kampagne, Guthaben. Limits zählen bestätigte und
reservierte Vorgänge; Kampagnenlimits über alle Codes. Rückabgewickelte Rabatte
zählen bis `limitReturnedAt` gesetzt ist. Bei Guthaben zählen auch teilweise
rückabgewickelte Einsätze, aber keine vollständig rückabgewickelten Einsätze.
Individuelle Rabattcodes haben ohne explizites Limit standardmäßig eins;
individuelle Wertgutscheine haben dieses implizite Limit nicht.

Gast-E-Mails werden normalisiert im `ruleSnapshot.customer.guestEmail` eingefroren
und per JSON-Pfad gezählt. Das ist ausdrücklich nur eine weiche Begrenzung, keine
Personenidentität. Kontolimits verwenden ausschließlich die Session-User-ID.
Snapshots vermeiden eine nachträgliche Änderung der gezählten Identität durch
Profiländerungen. Das bestehende JSON-Feld genügt hierfür; ein zusätzlicher
indexierter Identitätsschlüssel wäre erst eine spätere Skalierungsoptimierung.

Alle Mutationen laufen unter `Serializable`; Konflikte `P2034` werden wie bei
Stornierungen höchstens dreimal wiederholt. Die erneute Transaktion prüft Limits
und Guthaben neu. Andere Fehler werden nicht blind wiederholt. Bedingte
Saldoänderungen, eindeutige Vorgangsschlüssel und die Journal-Constraints ergänzen
die Transaktionsisolation. Ein serialisierbares Lesen/Zählen und Schreiben ist
hier zwingend; bloße Row-Locks ohne die Isolation sind kein Ersatz.

Freigabe ist kein Timer: `reservedUntil` allein wird nicht ausgewertet. Der
Reconciliation-/Webhook-Flow muss zuerst sicher belegen, dass Stripe nicht mehr
zahlen kann, und den vorhandenen Ablaufstatus dauerhaft schreiben. Der Helfer
prüft diesen Zustand erneut unter Sperre. Er akzeptiert kein vom Browser
geliefertes `expired=true`. Wiederholte Freigabe schreibt keine zweite Journalzeile;
ein bestätigter Verbrauch kann darüber nicht zurückgegeben werden.

## 13. Öffentliche Buchungs- und Checkout-Integration

### Implementierter Umfang

- `components/public-booking-form.tsx`: ein optionaler Code, serverseitige Vorschau,
  getrennte Anzeige von Originalpreis, Rabatt, Guthabeneinsatz und Zahlbetrag.
  Änderungen an Menge, E-Mail oder Code entwerten die Vorschau.
- `app/(public)/events/[companySlug]/[eventId]/actions.ts`: `previewPublicVoucher`
  prüft unverbindlich ohne Reservierung. `bookPublicEvent` prüft Event, Kapazität,
  signierten Originalpreis, Code, Ziele und Limits erneut in einer Serializable-
  Transaktion. Auch neue Buchungen ohne Gutschein erhalten einen `BookingPrice`.
- `lib/vouchers/service.ts`: interne Transaktionsbausteine `voucherTransaction`,
  `reserveVoucherInTransaction` und `releaseVoucherInTransaction`;
  keine öffentlichen Server Actions. Die Nutzer-ID stammt aus der Session.
- `lib/vouchers/settlement.ts`: `commitVoucherInTransaction` bestätigt einen
  reservierten Einsatz genau einmal nach Prüfung von Snapshot und Payment.
  Wertguthaben erzeugt `SPEND` mit `voucher:spend:<useId>` und reduziert Saldo und
  Reservierung gleichzeitig. Ein Rabatt erzeugt keine Guthabenbuchung.
- `lib/bookings/fulfillment.ts`: gemeinsame Ticket- und Mail-Outbox-Anlage für
  Nullbetrag und Stripe-Abschluss innerhalb der aufrufenden Transaktion.
- `lib/payments/fulfillment.ts`: verifizierter Stripe-Abschluss bestätigt Payment,
  Gutschein, Buchung, Tickets und Outbox atomar. Betrag und Währung müssen dem
  Preisnachweis entsprechen. Wiederholte oder verspätete Ereignisse erzeugen
  keinen zweiten Verbrauch und keine weiteren Tickets. Zwischenzeitliche Änderungen
  der Kampagne entwerten keine bereits reservierten und bezahlten Einsätze.
- `lib/payments/checkout.ts` und `app/api/payments/reconcile/route.ts`: sichere
  Ablaufbehandlung und Wiederaufnahme nachgewiesen abgelaufener Reservierungen.
- `lib/auth/rate-limit.ts`: eigene Drosselung für die öffentliche Gutscheinprüfung.

### Buchung und Zahlung

Die Vorschau reserviert nichts. Im finalen Ablauf werden Buchung, Reservierung
und unveränderlicher Preisnachweis zusammen geschrieben. Fehler rollen alles
zurück. Derselbe Token mit geändertem Event, Menge, Kontakt, Nutzer oder Code wird
abgelehnt. Unveränderte Wiederholungen verwenden gespeicherten Preis und Payment.
Bestehende Buchungen werden nicht nachträglich rabattiert.

Bei positivem Restbetrag bleibt der Gutschein `RESERVED`. Der Live-Connect-Refresh
findet außerhalb der DB-Transaktion statt: Der erste vorläufige Versuch wird ganz
zurückgerollt, danach wird erneut geprüft und reserviert. Stripe erhält exakt den
Restbetrag als **eine Buchungsposition mit Menge eins**, da nicht jeder Rabatt
centgenau auf Tickets teilbar ist. Die Ticketzahl bleibt in Buchung und Snapshot.
Bestehende Stripe-Idempotenzschlüssel und Wiederaufnahme gelten weiter.
Positive Restbeträge von 1–49 Cent werden abgelehnt.

Bei null Euro gibt es weder Payment noch Stripe-Checkout oder Connect-Refresh.
Reservierung, Verbrauch, Buchungsbestätigung, Tickets und Mailauftrag werden in
derselben Transaktion abgeschlossen. SMTP erfolgt erst nach Commit; bei Fehlern
bleibt die vorhandene Mail-Outbox für die Wiederholung zuständig.

### Ablauf und verbleibende Grenzen

Stripe-Status `expired` gibt zusammen mit dem Ablaufstatus die Reservierung atomar
frei. Ebenso erlaubt eine eindeutige `expires_at`-Ablehnung eines identischen
Erstellungsversuchs ohne bestehende Session die Freigabe. Netzwerkfehler, Browser-
Abbruch, lokale Fristüberschreitung oder unklarer Zahlungsstatus reichen nicht.
Reconciliation bearbeitet ausstehende Payments und zusätzlich bereits `EXPIRED`
markierte Buchungen mit reservierten Einsätzen. Der Helfer prüft erneut, dass auch
jedes vorhandene Payment `EXPIRED` ist.

Die bisherige 23-Stunden-Grenze für Stripe-Erstellungsversuche ohne gespeicherte
Session bleibt: Danach ist manuelle Statusklärung nötig, keine unsichere Freigabe
unter einem möglicherweise verworfenen Idempotenzschlüssel. Die reguläre Checkout-
Webhook- und Reconciliation-Integration ist umgesetzt. Stripe-Sandbox-Prüfung und
echte PostgreSQL-Parallelitätsprüfung bleiben offen.

Vollstorno, `REVERSED`/`limitReturnedAt`, `RESTORE` und der Schutz manueller
Buchungsaktionen sind inzwischen integriert (Abschnitt 14). Teilstorno-Aufteilung,
Gutscheinverwaltung und sichere Codeausgabe bleiben separate Schritte.

### Prüfung

`tests/public-booking.test.ts` prüft Vorschau, Buchungsintegration, Stripe-Restbetrag,
Nullbetrag, Replay und Ticket-/Outbox-Rollback. `tests/voucher-settlement.test.ts`
prüft Verbrauch, wiederholte/verzögerte Stripe-Ereignisse, Ablauf und Fehlerrollback.
`tests/vouchers.test.ts` und `tests/voucher-reservations.test.ts` prüfen die echte
Domänenberechnung, Ziele, Limits, Digest-Konfiguration und Reservierung/Freigabe.
Drei simulierte überlappende Transaktionen prüfen, dass nach einem `P2034`-Konflikt
das letzte Kampagnenlimit, Codelimit bzw. Guthaben erneut gelesen wird und nur ein
Versuch erfolgreich bleibt. Diese Testdoubles beweisen **keine PostgreSQL-Sperren**.
Eine vorhandene Testsuite für echte PostgreSQL-Parallelität wurde nicht gefunden.
Weder Datenbank noch Stripe-Sandbox werden durch diese Unit-Tests angesprochen.

## 14. Vollstorno und Erstattung

### Verbindlicher Zeitpunkt und Abschlussstatus

Der Abgleich hat eine wichtige Unterscheidung bestätigt: Abschnitt 8/E12 sieht die
Gutscheinrückgabe bereits bei genehmigtem Vollstorno vor; die frühere Beschreibung
fehlender Integration in Abschnitt 13 war ein Implementierungsstand. E12 bleibt
maßgeblich: Genehmigung, lokale Buchungs-/Ticketstornierung, Rabattlimit-Rückgabe,
Guthabenwiederherstellung und Mail-Outbox werden gemeinsam committed. Stripe wird
außerhalb dieser Transaktion ausschließlich mit `Payment.amount` erstattet;
bei Gutscheinbuchungen wird dieser Betrag zusätzlich gegen `BookingPrice` geprüft.
Rabatte werden nie ausgezahlt. Nullbetrag-Buchungen erzeugen keine Stripe-Erstattung.

`Booking.CANCELLED` bedeutet weiterhin: Teilnahme beendet, Tickets ungültig. Es ist
**kein Nachweis einer abgeschlossenen Geld-Erstattung**. Bei Payment bleibt die
Anfrage `APPROVED` mit Refundstatus `PENDING`, `FAILED` oder `REVIEW`, bis Stripe
Erfolg bestätigt. Erst dann gilt `SUCCEEDED` und Payment `REFUNDED`. Ohne Payment
gilt `NONE`, und die lokale Rückabwicklung ist abgeschlossen. Konto- und Company-
Ansichten zeigen zurückgegebenes Guthaben getrennt vom Geld-Erstattungsstatus.

### Gemeinsamer Rückabwicklungsweg

`lib/vouchers/reversal.ts` stellt `reverseBookingVoucher` bereit. Es ist keine
Server Action. Der aufrufende Serializable-Ablauf muss entweder eine genehmigte
`CancellationRequest` oder eine verifizierte externe Vollerstattung nachweisen.
Vorhandene Login-, Eigentümer- und Company-Berechtigungen bleiben unverändert.
Eine wiederholte identische Entscheidung wird nach erneuter Autorisierung ohne
neue Mutation beantwortet. Gäste erhalten dadurch keinen neuen Selbststornozugang.

Der Helfer sperrt Buchung, Kampagne und bei Wertguthaben das Guthabenkonto.
Preisnachweis, Einsatzbetrag, EUR, Payment und ursprünglicher `SPEND` werden geprüft.
Fehlende oder widersprüchliche Historie verhindert die Rückabwicklung; es werden
keine Preise, Verbrauchsbeträge oder Gültigkeitsdaten erfunden.

- Rabatt: `COMMITTED → REVERSED`, `reversedAt` und `limitReturnedAt`. Die bestehenden
  Limitabfragen zählen diese Nutzung nicht mehr; keine manuelle Zählerkorrektur.
- Wertguthaben: genau eine neue `RESTORE`-Zeile mit dem stabilen Operationsschlüssel
  `voucher:restore:full:<useId>`, `reversalOfId` auf den ursprünglichen `SPEND`,
  Einsatz-/Guthabenreferenzen sowie Storno-ID oder Stripe-Refund-ID. Saldo steigt
  um den tatsächlich verbrauchten Betrag, Reservierungen bleiben unverändert.
  Einsatz wird `REVERSED`, `restoredMinor = amountMinor`. Historische Einträge und
  Snapshots werden weder geändert noch gelöscht.
- Wiederholungen prüfen die bestehende Rückabwicklung. Transaktionswiederholung bei
  `P2034`, stabile Operationsschlüssel und die vorhandenen SQL-Constraints schützen
  auch konkurrierende interne und externe Abschlüsse.

`VoucherBalance.expiresAt` ist das im aktuellen Modell gespeicherte ursprüngliche
Ablaufdatum dieses Kontos; `NULL` bedeutet keine Guthabenfrist. Im geprüften
Repository gibt es keinen Ablaufdatum-Änderungspfad. Die Wiederherstellung erfolgt
auf **demselben** Konto und schreibt weder `expiresAt` noch dessen Status. Ein
abgelaufenes oder gesperrtes Guthaben wird nicht reaktiviert. Kampagnenfristen
werden nicht als Ersatz herangezogen. Für spätere Kulanzverlängerungen braucht es
zusätzliche, nachvollziehbare Gültigkeitshistorie; das bestehende Geldjournal allein
speichert keine Datumsänderungen. Wurde ein Konto außerhalb der Anwendung bereits
undokumentiert umdatiert, lässt sich ein früheres Datum nicht rekonstruieren:
diesen Datenbestand vor Nutzung fachlich klären, keine automatische Rückdatierung.
Für den bestehenden Ablauf ist keine Schemaänderung erforderlich.

### Stripe, Webhooks und Wiederaufnahme

`lib/cancellations/refunds.ts` behält den Refund-Lease, vollständige paginierte
Suche und `cancellation-<requestId>-<attempt>` bei. Netzwerkfehler bleiben unklar;
der Versuchsschlüssel wird nicht gewechselt. Ein neuer Versuch erfordert weiterhin
einen definitiven Fehler und eine berechtigte Wiederaufnahme. Vor einem neuen
Stripe-Aufruf wird die Gutscheinhistorie geprüft. Bereits zurückgegebenes Guthaben
wird bei späterem Stripe-Erfolg oder Fehler nicht erneut verändert.

`lib/payments/refund-reconciliation.ts` synchronisiert ausschließlich lesend von
Stripe: aktueller Charge/PaymentIntent, alle Refund-Seiten und nur `succeeded`-
Beträge. `applyRefund` in `lib/payments/fulfillment.ts` führt externe Vollerstattung
über denselben Rückabwicklungshelfer. Event-ID und finanzielle Zustände deduplizieren;
auch verschiedene Event-IDs können denselben Einsatz nicht zweimal zurückgeben.
Eine bereits offene Stornoanfrage wird bei bestätigter externer Vollerstattung
als APPROVED/SUCCEEDED mit Zeitstempel und interner Herkunftsnotiz abgeschlossen;
es wird kein lokaler Entscheider erfunden und kein weiterer Refund angefordert.
Der Webhook synchronisiert ausschließlich Status und fordert keine Erstattung an.
Stripe-Schreibaufrufe bleiben dem genehmigten Stornoauftrag und dessen Worker vorbehalten.
Logs enthalten Vorgangs-/Event-IDs, keine vollständigen Stripe-Fehlerobjekte.

Externe Teilerstattungen setzen `PARTIALLY_REFUNDED` als bestehenden Prüfstatus.
Ohne internen Vollstorno bleiben Tickets und Gutscheine unverändert. Bestehende
noch offene genehmigte Erstattungsaufträge erhalten `REVIEW`; eine bereits bei
Genehmigung ausgeführte volle Gutscheinrückgabe wird nicht zurückgenommen und nicht
anteilig ergänzt. Neue interne Vollerstattung nach Teilrefund ist gesperrt.
Erreicht die Summe bestätigter externer Refunds später die volle Stripe-Zahlung,
führt das zum vollständigen Abschluss. Ein verspäteter Teilrefund darf `REFUNDED`
nicht herabstufen. Ticketbezogene Teilstornos bleiben unimplementiert.

Der geschützte Reconcile-Endpunkt bearbeitet zusätzlich bis zu 50 Gutschein-Payments
mit noch verbrauchter Nutzung und Status PAID/PARTIALLY_REFUNDED/REFUNDED, um verlorene
Dashboard-Webhooks nachzuholen. Fehler lassen den Zustand unverändert; `updatedAt`
rotiert die Batches. Offene Stornoaufträge einschließlich FAILED werden geprüft,
aber FAILED wird ohne berechtigten expliziten Retry nicht erneut ausgezahlt.
Eine externe Vollerstattung nach einem gescheiterten internen Versuch kann dadurch
auch ohne Webhook gefunden werden. Der bestehende Scheduler muss weiterhin laufen.

### Alternative Verwaltungswege und Prüfung

Manuelle Buchungsänderungen und Löschungen unter
`app/company/[companyKey]/events/[eventId]/bookings/actions.ts` sind bei Preisnachweis
oder Gutscheinhistorie gesperrt, auch bei null Euro. `upsertExternalBooking` rollt
Importänderungen bei Zahlungs-, Preis- oder Gutscheinhistorie zurück. Die bestehenden
Berechtigungsprüfungen bleiben erhalten. Event-/Company-Löschungen umgehen diesen
Schutz nicht: Buchungsreferenzen sind `Restrict`, Eventlöschung verlangt keine
Buchungen. Eine Eventabsage bleibt ohne automatische Sammelstornierung.

Gezielte Tests: `voucher-reversal.test.ts`, `voucher-refund-reconciliation.test.ts`,
Storno-/Refund-/Webhook-Suites, manuelle Buchungsverwaltung und externe Importe.
Geprüft werden Stripe plus Guthaben, Rabatt, Nullbetrag, Replay, abgelaufenes
Guthaben, verlorene Antwort, pending/failed, Teilrefund, Rollback und simulierte
konkurrierende Rückabwicklungen. Keine echte PostgreSQL-Parallelitätssuite vorhanden;
Testdoubles beweisen keine realen Datenbanksperren. Vor Livebetrieb bleiben echte
PostgreSQL-Konkurrenztests und Stripe-Sandbox-Ende-zu-Ende-Prüfungen erforderlich.

## 15. Administrative Kampagnen- und Codeverwaltung

### Seiten und Berechtigungen

- `/company/[companyKey]/vouchers`: Company-Kampagnen, serverseitige Kennzahlen,
  Zielauswahl und Anlegen neuer Entwürfe.
- `/company/[companyKey]/vouchers/[campaignId]`: Bearbeitung, Statuswechsel,
  Codeausgabe, Codes und Einlösungshistorie; je Liste 50 Datensätze pro Seite.
- `/admin/vouchers`: Company-Auswahl für Plattform-Admins. Der vorhandene
  Company-Editor wird wiederverwendet, kein zweites Berechtigungsmodell.
- `components/voucher-admin-forms.tsx` und `voucher-admin-view.tsx`: Formulare,
  einmalige Codeanzeige und Auswertungen. Navigation für aktive `COMPANY_ADMIN`,
  aktive `COMPANY_USER` und Plattform-Admins; ausgeblendete Navigation ist kein Zugriffsschutz.

Jede Lese- und Schreiboperation verwendet serverseitige Rollenprüfung. Mutationen
prüfen innerhalb ihrer Serializable-Transaktion die aktuelle DB-Rolle und eine aktive
Company-Mitgliedschaft als `COMPANY_ADMIN` oder `COMPANY_USER`. `ADMIN` darf ohne
Mitgliedschaft in einer Company arbeiten. Die Kampagne muss zur
Company der Route gehören, auch wenn eine fremde Kampagnen-ID manipuliert wird.
`authorization.ts` enthält dafür den gemeinsamen Gutschein-Company-Prüfer.

Jede übermittelte Company-, Reihen-, Event- und Venue-ID wird einzeln auf Existenz
und Zuständigkeit geprüft. Die Company der Verwaltungs-URL begrenzt die Zielauswahl
auch für Plattform-Admins: auswählbar sind die gesamte aktuelle Company oder deren
Reihen, Events und Venues. Es entsteht kein Approval-System.
Ein aktiver Datensatz benötigt mindestens ein Ziel; ebenso ist eine Codeausgabe
bei leerer Zielauswahl gesperrt. ODER-Verknüpfung und dynamische Ziele bleiben wie
in Abschnitt 4 beschrieben. Auswahllisten sind noch ohne Suche; sehr große
Zielbestände benötigen künftig eine serverseitige Suchauswahl.

Company-Mitglieder sehen Buchungsreferenzen nur aus Events ihrer Company. Gezeigte
Referenzen enthalten keine Kundennamen oder E-Mail-Adressen. Plattform-Admins
können im Rahmen ihres bestehenden übergreifenden Zugriffs auch fremde
Buchungsreferenzen sehen. Kampagnenweite Summen und Limits gelten über alle Codes.
Die optionale Empfängerbindung verwendet eine User-ID: Company-Mitglieder können sie
nur an aktive Mitglieder oder bereits vorhandene Buchungskonten ihrer Company
binden. Es wird kein globales Benutzerverzeichnis an Company-Mitglieder ausgeliefert.

### Eingaben, Beschreibungen und Änderungsgrenzen

`admin-validation.ts` validiert EUR, ganzzahlige Cent/Basispunkte, Laufzeiten,
positive Limits und begrenzte Zeichenlängen. Geld und Prozente dürfen maximal zwei
Nachkommastellen haben. Zeitangaben verwenden den bestehenden Berlin-Datumshelfer;
nicht existierende Sommerzeit-Uhrzeiten werden abgelehnt. Bei neuen doppeldeutigen
Herbstzeiten gilt wie im vorhandenen Helfer das frühere Vorkommen.

Das Schema hat kein eigenes Beschreibungsfeld. Die interne Beschreibung wird als
`VoucherCampaign.policy.adminDescription` gespeichert; andere vorhandene Policy-
Felder bleiben erhalten. Das ist Metadatenpflege, keine neue Preisregel und keine
Schemaänderung. Prozent-/Festbetragsberechnung, Ticketgrenzen und Wertguthabeneinsatz
bleiben in der vorhandenen Domänenschicht; 100 % ohne Ticketgrenze rabattiert ein Ticket.

**Konservative Änderungsgrenze / offene Fachentscheidung:** Nach erster Codeausgabe
oder vorhandener Nutzung sind Art, Wert, Währung, Laufzeit, Limits, Ticketgrenze,
Quelle und Ziele gesperrt. Das verhindert eine stillschweigende Umdeutung bereits
ausgegebener Berechtigungen. Name und Beschreibung bleiben bearbeitbar; Änderungen
unbenutzter Regeln erhöhen `ruleVersion`. Künftige Änderungen laufender Kampagnen
brauchen eine ausdrückliche Regel für bestehende Codes und offene Checkouts.
Historische Snapshots werden niemals überschrieben.

Statuswechsel lassen gespeicherte Reservierungen und Zahlungsabschlüsse unberührt;
Pause/Sperre verhindern neue Einlösungen. Archivierung ist im Verwaltungs-MVP
endgültig, archivierte Kampagnen sind schreibgeschützt; es gibt keinen Löschpfad.
**Offen:** Für bereits ausgegebene Wertguthaben fehlen fachliche Regeln zum
endgültigen Abschluss einschließlich möglicher späterer Wiederherstellungen.
Deshalb ist deren permanente Kampagnen-/Codearchivierung gesperrt; reversibles
Pausieren beziehungsweise Sperren ist möglich. Unbenutzte Wertkampagnen sowie
Rabattkampagnen/-codes können archiviert werden. Es wird kein Guthaben gelöscht,
verlängert, umgebucht oder ausgezahlt.

### Codeausgabe, Digest-Rotation und Idempotenz

`admin-service.ts` stellt die Ausgabe ausschließlich als administrative Operation
bereit. Eine Kampagne kann mehrere öffentliche Mehrfachcodes und individuelle Codes
kombinieren. Öffentliche Codes werden einzeln ausgegeben, teilen die Regeln und
Limits ihrer Kampagne und bleiben über Code, Quelle und Batch getrennt auswertbar.
Ihr normalisierter Digest ist kampagnenübergreifend eindeutig. Bereits archivierte
Codes und ihre Historie bleiben unverändert erhalten.
Individuelle Rabattcodes sind Einmalcodes; individuelle Wertgutscheine behalten
Teileinsätze und erhalten ohne explizites Code-Limit kein Einmal-Limit.

Ein Batch erzeugt 1–100 individuelle Codes. Zufallscodes enthalten 20 kryptographisch
zufällige Bytes, dargestellt mit `VG-` und Hex-Zeichen. Öffentliche Wunschcodes
verwenden die vorhandene Normalisierung, benötigen bei Neuausgabe aber mindestens
acht Zeichen: Die vier gespeicherten Endzeichen dürfen nicht den ganzen Code
preisgeben. Datenbank und spätere Leseansichten speichern/zeigen nur Digest,
Version beziehungsweise Endzeichen und nicht geheime Datensatzreferenzen; Digests
werden überhaupt nicht an Verwaltungsformulare ausgeliefert.

Eine UUID identifiziert die Ausgabeabsicht innerhalb einer Company. `batchId` und
deterministische Code-Primärschlüssel binden alle Datensätze daran. Ein erneuter
Aufruf desselben Batches erzeugt nichts und liefert **keinen Klartext** zurück;
eine geänderte Kampagne bei derselben ID wird abgelehnt. Andere geänderte Eingaben
machen aus einem bereits gespeicherten Batch ebenfalls keine neue Ausgabe. Eine
neue Ausgabe wird ausdrücklich durch erneutes Öffnen des Ausgabeformulars begonnen.

Alle Ausgabeoperationen nutzen zusätzlich dieselbe transaktionale PostgreSQL-
Advisory-Sperre. Vor Erstellung werden Kollisionen gegen **alle** konfigurierten
Digest-Versionen geprüft. Solange Codes mit einer gespeicherten Version vorhanden
sind, muss diese Version für die administrative Ausgabe im Schlüsselring bleiben,
auch für deaktivierte/archivierte Codes. Fehlt sie, wird die Ausgabe sicher blockiert,
weil ein Unique-Index auf den Digest allein versionsübergreifende Dopplungen nicht
verhindert. Spätere Schlüsselentfernung braucht eine gesonderte Strategie für
historische Code-Eindeutigkeit; Schlüsselmaterial wird nie in der Anwendung gespeichert.

Klartext wird nur im erfolgreichen ersten Action-Ergebnis geliefert und im Browser
angezeigt. Er wird weder serverseitig wiederhergestellt noch in Local-/Session-
Storage, URL, Logs oder Telemetrie geschrieben. Bei verlorener Antwort können Codes
nicht erneut abgerufen werden: Ausgabe anhand des Batches prüfen, nötigenfalls
Codes sperren und eine neue Ausgabe bewusst starten. Die UI bietet eine kopierbare
Liste. Im Repository besteht kein sicherer Batch-Exportablauf; ein nachträglicher
Download-Endpunkt wird nicht eingeführt. Kopierte Codes müssen vom Administrator
im vorgesehenen Empfängerkreis weitergegeben werden.

### Administrative Wertguthaben und Auswertung

Pro individuellem Wertcode entstehen in **derselben Transaktion** ein Guthabenkonto
mit Aussteller-Company und Ausgabereferenz sowie genau ein unveränderlicher
`ISSUE`-Eintrag. Der initiale Saldo entspricht dem Kampagnen-Ausgabewert;
`voucher:issue:<codeId>` und der vorhandene partielle Unique-Index verhindern doppelte
Ausgaben. Die Ausgabeherkunft ist `ADMIN`, der handelnde User wird im Journal
vermerkt. Ein Fehler rollt Code, Guthaben und Journal zurück. Das optionale
Guthaben-Ablaufdatum wird nur bei Ausgabe gesetzt und später nicht bearbeitet.
Kampagnenlaufzeit und Guthabengültigkeit werden bei Einlösung beide geprüft.
Verkaufsgutscheine und Stripe-Verkaufsabwicklung sind nicht unterstützt.

Übersicht und Details aggregieren Einlösungsstatus, wirksame Rabatte, Codeanzahl,
Ausgabe, Reservierung, Bruttoverbrauch und Wiederherstellung serverseitig. Das
verbleibende Limit zählt wie die Einlösungslogik reservierte und wirksame Nutzungen;
rückabgewickelte Rabatte zählen nur ohne `limitReturnedAt`. Verfügbares Guthaben
schließt pausierte/archivierte Kampagnen, gesperrte/abgelaufene Codes und Guthaben
sowie Reservierungen aus. Es ist eine finanzielle Summe, keine Zusage zur Einlösung
für einen bestimmten Kunden oder Event; Ziele und Nutzungslimits gelten zusätzlich.
Datensatzreferenzen unterscheiden Codes mit zufällig gleichen Endzeichen.

### Prüfung und verbleibende Grenzen

`voucher-admin.test.ts` prüft Rollen, Fremdziele, Aktivierung, Regelschutz,
Digest-Rotation, Einmalanzeige, `ISSUE`, Wiederholung, Fehlerrollback und simulierte
konkurrierende Ausgaben. `voucher-admin-data.test.ts` prüft Summen, Company-Scope und
geheimnisfreie Leseselektionen. `voucher-admin-ui.test.ts` nutzt React/DOM für
Formularbedienung und einmalige Klartextanzeige; Navigationstests prüfen die Rollen.
Die bestehenden Gutschein-/Buchungs-/Storno-Tests bleiben maßgeblich.
Die Testdoubles ersetzen keine echte PostgreSQL-Parallelitätsprüfung. Keine
Migration oder Änderung bestehender Daten war für die Verwaltung erforderlich.
