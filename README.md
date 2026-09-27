# 🌌 DarkFlow — Modern Helpdesk Platform

[![React](https://shields.io)](https://react.dev/)
[![Vite](https://shields.io)](https://vite.dev)
[![Drizzle](https://shields.io)](https://drizzle.team)
[![PostgreSQL](https://shields.io)](https://postgresql.org)

**DarkFlow** is a streamlined, full-stack customer support and helpdesk application. Built for speed and optimal user experience, it features a dynamic React frontend paired with a robust relational database backend to manage tickets, departments, and user workflows in real time.

---

## ✨ Features

- **Ticket Lifecycle Management:** Create, update, and resolve support requests dynamically.
- **Department Routing:** Efficient distribution of customer messages to 4 core departments.
- **Super Admin Panel:** Built-in administration configuration tool for deep control.
- **Optimized for Speed:** Powered by React + Vite with Hot Module Replacement (HMR) for near-instant development loads.

---

## 🛠️ Tech Stack

### Frontend

- **Framework:** React 19
- **Build Tool:** Vite (with HMR support)
- **Plugins:** `@vitejs/plugin-react` (utilizing [Oxc](https://oxc.rs) for lightning-fast parsing)

### Backend & Database

- **Runtime:** Node.js (utilizing native `--env-file` injection)
- **Database Driver:** PostgreSQL (`pg`)
- **ORM:** Drizzle ORM & `drizzle-kit` for schema migrations

---

## 🚀 Getting Started

### 1. Prerequisites

Ensure you have **Node.js** and a running **PostgreSQL** instance.

### 2. Database Setup (Server)

Navigate to your server directory, configure your `.env` file, and prepare the database:

```bash
# Generate SQL schema files
npm run db:generate

# Apply migrations to PostgreSQL
node --env-file=.env node_modules/.bin/drizzle-kit migrate

# Seed initial data (Admin user, departments, settings)
npm run db:seed
```

### 3. Run the Application

Start your development environment:

```bash
npm run dev
```

---

## ⚙️ Configuration Notes

### Environment Variables

Ensure you have a `.env` file in your server directory matching this format:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/darkflow_db
```

### Expanding ESLint

If scaling this into a production environment, we highly recommend switching to the [TypeScript variant template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) to enable type-aware lint rules via `typescript-eslint`.
