# Refonte UI — direction de design

**Date :** 2026-06-23 · **Branche :** `refonte-ui`
**Objectif :** interface propre, pro, lisible, sobre, flat. Refonte par le **système** (tokens + composants partagés) puis ré-application page par page, validée par captures d'écran headless.

## Méthode (boucle de validation)

Script `scratchpad/shot.ts` : pilote Chrome headless (`puppeteer-core`) sur `localhost:5173` (auth OFF en local), capture chaque route en PNG. Boucle : screenshot « avant » → édition → screenshot « après » → comparaison visuelle → itération.

## Décisions

- **Icônes :** `lucide-react` (jeu d'icônes ligne cohérent) — remplace l'emoji 🤖 + glyphes unicode dépareillés.
- **Accent :** bleu `#3b82f6` conservé mais sobre (liens + état actif seulement). Vert/rouge réservés aux P&L.
- **Validation :** fondations + Dashboard d'abord, puis déroulé du reste.

## Tokens (`styles.css`, `@theme`)

| token | valeur | usage |
|---|---|---|
| `surface` | `#0a0c11` | fond appli |
| `panel` | `#111620` | cartes / sidebar |
| `panel2` | `#1a2030` | inputs, hover, élevé |
| `edge` | `#273043` | bordures (visibles) |
| `up` / `down` | `#26a69a` / `#ef5350` | données P&L / bougies |
| `accent` | `#3b82f6` | liens + actif |

Élévation par contraste de surface + bordure visible (pas d'ombres lourdes = flat). Nombres tabulaires globaux (`tnum`).

## Composants partagés (`components/ui.tsx`)

- `PageHeader({ title, subtitle?, actions? })` — en-tête uniforme sur toutes les pages (corrige notamment Trades).
- `Stat({ label, value, sub?, tone? })` — carte KPI (label uppercase, valeur 2xl, sous-texte).
- `Card`, `Modal`, `Badge`, `Field`, `Empty`, `ProgressBar`, `Spinner` — affinés.

## Classes (`styles.css`)

- Boutons : `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` (outline → plein au survol) / `.btn-kill` (le seul rouge plein) / `.btn-success` ; modificateurs `.btn-sm`, `.btn-icon`.
- Tables : en-têtes uppercase discrets, lignes avec hover, full-bleed dans une carte `bodyClassName="p-0"`.
- Inputs : `.input` plus respirant, focus accent.

## Hiérarchie du rouge

Un seul rouge plein = action « nucléaire » (`.btn-kill`, ex. « Tout fermer »). Kill switch (positions conservées) et suppressions = `.btn-danger` outline. Bandeau kill switch = bordure + fond `down/15`.

## Ordre d'application

1. ✅ Fondations (tokens, classes, `ui.tsx`, `Layout`) + **Dashboard**
2. Listes : Bots, Backtests, Strategies, Optimizer, Trades, Data
3. Détails : BacktestDetail (regrouper le mur de métriques), BotDetail, StrategyDetail, OptimizationDetail
4. Formulaires : Patterns, Settings, Login, ParamsForm
5. Revue finale : re-capture complète, passe d'alignement/cohérence

Graphiques (lightweight-charts) : on ne touche qu'à l'habillage autour, pas au rendu.
