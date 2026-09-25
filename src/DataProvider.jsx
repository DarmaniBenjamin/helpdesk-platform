import { useState } from "react";
import { DataContext } from "./useData";
import {
  tickets as startingTickets,
  customers as startingCustomers,
  SLA_HOURS,
  HOUR,
} from "./data";

// Wraps the whole app and keeps the tickets and customers in one place.
// Later, this is where the app will load from / save to the backend.
export default function DataProvider({ children }) {
  const [tickets, setTickets] = useState(startingTickets);
  const [customers, setCustomers] = useState(startingCustomers);

  function addCustomer(fields) {
    const customer = {
      id: Math.max(...customers.map((c) => c.id)) + 1,
      name: fields.name.trim(),
      email: fields.email.trim().toLowerCase(),
      phone: fields.phone.trim(),
      company: fields.company.trim() || null, // empty means an individual
      createdAt: Date.now(),
    };
    setCustomers((list) => [customer, ...list]);
    return customer;
  }

  function addTicket({
    customer,
    subject,
    department,
    priority,
    dueBy,
    description,
  }) {
    const now = Date.now();
    const ticket = {
      id: Math.max(...tickets.map((t) => t.id)) + 1,
      subject,
      description,
      status: "open",
      priority,
      department,
      customerId: customer.id,
      requester: customer,
      assignee: null,
      source: "agent",
      createdAt: now,
      firstResponseDue: now + SLA_HOURS[priority].firstResponse * HOUR,
      dueBy,
      firstRespondedAt: null,
      resolvedAt: null,
      closedAt: null,
      messages: [
        {
          id: 1,
          kind: "customer",
          author: customer.name,
          body: description,
          at: now,
        },
      ],
      updatedAt: now,
    };
    setTickets((list) => [ticket, ...list]); // newest first
    return ticket;
  }

  return (
    <DataContext.Provider
      value={{ tickets, customers, addTicket, addCustomer }}
    >
      {children}
    </DataContext.Provider>
  );
}
