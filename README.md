# Quantum Sport Backend

This project is a backend API built with [Hono](https://hono.dev/) for Quantum Sport. You can set up and run the API using either **npm** or **bun**.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended) or [Bun](https://bun.sh/)
- [Git](https://git-scm.com/)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/quantum-sport-backend.git
cd quantum-sport-backend
```

### 2. Install Dependencies

#### Using npm

```bash
npm install
```

#### Using Bun

```bash
bun install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update the values as needed:

```bash
cp .env.example .env
```

### 4. Generate Prisma Client

#### Using npm

```bash
npm run db:push
```

#### Using Bun

```bash
bun run db:push
```

### 5. Run the Development Server

#### Using npm

```bash
npm run dev
```

#### Using Bun

```bash
bun dev
```

The API will be available at `http://localhost:3000`.

## Scripts

- `dev`: Start the development server
- `start`: Start the production server
- `build`: Build the project for production

## Learn More

- [Hono Documentation](https://hono.dev/)
- [Bun Documentation](https://bun.sh/docs)
- [Node.js Documentation](https://nodejs.org/en/docs/)

---

Feel free to open issues or contribute!
