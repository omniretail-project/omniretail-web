export type OrderNotificationContact =
  | {
      emailMode: "send";
      email: string;
    }
  | {
      emailMode: "not_applicable";
    };
