import { createContext, useContext } from "react";

// The "shared box" that holds tickets and customers for the whole app
export const DataContext = createContext(null);

// Any component can call useData() to get tickets, customers,
// addTicket and addCustomer, without passing them down as props
export default function useData() {
  return useContext(DataContext);
}
