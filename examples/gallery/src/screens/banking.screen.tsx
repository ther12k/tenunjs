import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { Avatar, HeroCard, ListTile } from "@tenunjs-examples/ui-kit";

/**
 * Rally-style banking module (M3 design language): a gradient balance
 * hero, account tiles with avatars, and upcoming bills with pay actions —
 * the classic Flutter finance reference.
 */
export interface Account {
  readonly name: string;
  readonly kind: "checking" | "savings";
  readonly balance: number;
}

export interface Bill {
  readonly name: string;
  readonly due: string;
  readonly amount: number;
  readonly paid: boolean;
}

export interface BankingState {
  readonly accounts: readonly Account[];
  readonly bills: readonly Bill[];
}

export const BankingScreen = defineScreen({
  name: "Banking",

  initialState: (): BankingState => ({
    accounts: [
      { name: "Everyday", kind: "checking", balance: 2431.5 },
      { name: "Rainy day", kind: "savings", balance: 9120.25 },
      { name: "Travel fund", kind: "savings", balance: 780.0 },
    ],
    bills: [
      { name: "Internet", due: "Sep 20", amount: 45.0, paid: false },
      { name: "Rent", due: "Sep 28", amount: 890.0, paid: false },
      { name: "Streaming", due: "Sep 30", amount: 12.99, paid: true },
    ],
  }),

  actions: {
    /** Moves an amount between checking and the first savings account. */
    transfer: defineAction<BankingState, number>({
      run({ input, state }) {
        const amount = Math.max(0, input);
        const from = state.accounts.findIndex((a) => a.kind === "checking");
        const to = state.accounts.findIndex((a) => a.kind === "savings");
        if (from < 0 || to < 0 || from === to) return;
        const accounts = state.accounts.map((a) => ({ ...a }));
        const moved = Math.min(amount, accounts[from].balance);
        accounts[from] = { ...accounts[from], balance: accounts[from].balance - moved };
        accounts[to] = { ...accounts[to], balance: accounts[to].balance + moved };
        (state as unknown as { accounts: Account[] }).accounts = accounts;
      },
    }),

    payBill: defineAction<BankingState, string>({
      run({ input, state }) {
        const bills = state.bills.map((b) =>
          b.name === input && !b.paid ? { ...b, paid: true } : b
        );
        (state as unknown as { bills: Bill[] }).bills = bills;
      },
    }),
  },

  view({ state, actions }) {
    const total = state.accounts.reduce((sum, a) => sum + a.balance, 0);
    const due = state.bills.filter((b) => !b.paid);

    return (
      <Scaffold appBar={<AppBar title="Banking" />}>
        <Column padding="lg" gap="lg">
          <HeroCard
            title="Total balance"
            headline={total.toFixed(2)}
            caption={`${state.accounts.length} accounts · ${due.length} bills due`}
          />

          <Row gap="sm">
            <Button variant="primary" onPress={() => actions.transfer(100)}>
              Transfer 100 to savings
            </Button>
          </Row>

          <Column gap="sm">
            <Text variant="title">Accounts</Text>
            {state.accounts.map((account) => (
              <ListTile
                key={account.name}
                leading={
                  <Avatar
                    label={account.name.slice(0, 1)}
                    color="#232F49"
                    textColor={account.kind === "checking" ? "#4C8DFF" : "#3DD68C"}
                  />
                }
                title={account.name}
                subtitle={account.kind}
                trailing={<Text variant="title">{account.balance.toFixed(2)}</Text>}
              />
            ))}
          </Column>

          <Column gap="sm">
            <Text variant="title">Upcoming bills</Text>
            {state.bills.map((bill) => (
              <ListTile
                key={bill.name}
                leading={
                  <Avatar
                    label={bill.paid ? "✓" : "!"}
                    color={bill.paid ? "#173327" : "#33261A"}
                    textColor={bill.paid ? "#3DD68C" : "#F5A623"}
                  />
                }
                title={bill.name}
                subtitle={
                  bill.paid
                    ? `Due ${bill.due} · paid`
                    : `Due ${bill.due} · ${bill.amount.toFixed(2)}`
                }
                trailing={
                  bill.paid ? null : (
                    <Button variant="secondary" onPress={() => actions.payBill(bill.name)}>
                      Pay
                    </Button>
                  )
                }
              />
            ))}
          </Column>
        </Column>
      </Scaffold>
    );
  },
});
