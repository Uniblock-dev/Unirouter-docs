# Hopscotch customer docs

The words this site uses when it talks to customers about paying for and limiting what they use. Where a dashboard screen already labels a concept, this glossary uses that label; otherwise it uses the word a developer would expect from any other usage-billed API. The billing terms mirror the Billing section of the source repository's root glossary, and where the two disagree the source repository is right.

## Language

### Billing

**Billing**:
The whole subject of how a workspace pays for what it uses: buying credit, charges, the platform fee, and the statement. It is the heading word for anything that would otherwise be called "money".
_Avoid_: money, the money model, the money path, money flow

**Pricing**:
What a model or a usage type costs per unit at the provider's own rates.
_Avoid_: money model, rate card (in prose)

**Credit**:
Prepaid spending power on a workspace, in US dollars. When a sentence means "an amount on the balance", it says credit.
_Avoid_: money (as an amount), funds

**Buy credit**:
The act of adding credit to a workspace by card. The Billing screen calls the section "Buy credits".
_Avoid_: top up, load, deposit, fund

**Auto reload**:
A credit purchase made on the saved card when the balance falls below a threshold the customer set. Off until the customer turns it on.
_Avoid_: top-up, automatic top-up

**Platform fee**:
The percentage Hopscotch adds to a credit purchase, charged at purchase and never on a request.
_Avoid_: our fee, markup, surcharge, commission

**Charge**:
What one served request costs, taken from the balance. It is also the word for the amount a card is billed at purchase, which the prose always qualifies as "the amount charged to your card".
_Avoid_: debit, deduction, money spent

**Spend**:
Credit used by charges over a period. A verb ("requests spend credit") or a total ("spend this week"); never a synonym for the balance.
_Avoid_: burn, consumption, money spent

### Balance

**Balance**:
The credit a workspace has. Unqualified, it means the available balance, because that is the figure the Billing screen leads with.
_Avoid_: funds, wallet, account money

**Available balance**:
What a new request can spend right now: the settled balance minus every hold. The Billing screen labels it "Available to spend".
_Avoid_: free balance, spendable money

**Settled balance**:
The balance before holds are taken off it. The Billing screen labels it "Settled".
_Avoid_: ledger balance, ledger total, current balance

**Hold**:
Credit set aside for a request that is still running, for the most it could cost, and given back when it finishes, at which point the request is charged what it used. The Billing screen totals them as "Held for requests in flight".
_Avoid_: reservation, reserve, money reserved, reserved credit, pre-authorization

### The statement

**Statement**:
The dated list of every transaction on a workspace's balance, newest first, on the Billing screen's Statement tab.
_Avoid_: ledger, money movements, history

**Transaction**:
One change to the balance, such as a purchase, a charge or an adjustment. It appears as one line on the statement.
_Avoid_: movement, money movement, ledger entry, entry

**Running balance**:
The settled balance after a transaction, printed beside it on the statement.
_Avoid_: running ledger total, running total

### Limits

**Rate limit**:
A ceiling on how many requests one API key may send in a window. It counts requests, never credit.
_Avoid_: throttle, quota

**Spend limit**:
A ceiling on how much credit a workspace or a key may spend. It is the family name; each specific control keeps the label the dashboard gives it, such as "Monthly limit" or "Credit limit".
_Avoid_: money limit, budget, quota

**Spend rate cap**:
The spend limit that counts holds over a rolling window, and the one a customer may raise themselves. The Limits section of Settings labels it "Spend per rolling 60 seconds". Because it counts holds rather than charges, a request that omits `max_tokens` meets it sooner.
_Avoid_: spend cap (a guardrail's own field), money rate limit, money reserved

### Not billing words

**Key reservation**:
A promised API key attached to an invitation. It is the only thing this site calls a reservation, which is why a hold is never called one.
_Avoid_: pending key, reserved key

## Flagged ambiguities

- "Reserved", "reservation" and "hold" were all used for credit set aside for a running request, while "key reservation" means something unrelated. Resolved: credit is **held**, and only keys are **reserved**. The API's own error text still says "reserved"; a page that quotes it keeps it verbatim and says once that it means held.
- "Money" was used for the subject (billing), the amount (credit), what a request costs (a charge) and a balance change (a transaction). Resolved: each sense takes its own word, and "money" leaves customer prose.
- "Ledger" and "statement" named the same record. Resolved: customers read a **statement**; "ledger" is an internal word.
- "Spend rate cap" looked like it might clash with the dashboard's "Spend cap". Resolved: "Spend cap" is a guardrail field, and the spend rate cap's own label is "Spend per rolling 60 seconds".
