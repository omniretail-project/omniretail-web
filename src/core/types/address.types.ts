export interface AddressSnapshot {
  recipientName: string;
  recipientPhone?: string;
  line1: string;
  line2?: string;
  city: string;
  stateOrDepartment?: string;
  postalCode?: string;
  country: string;
  references?: string;
}
