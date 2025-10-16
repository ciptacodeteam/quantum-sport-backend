# Development Guide: Adding a New API Route

Follow these steps to add a new API route to the project.

## 1. Create a New Route File

1. **Locate the routes directory** (e.g., `src/routes/`).
2. **Copy an existing route file** as a template (e.g., `user.route.ts`).
3. **Rename the copied file** to match your new route (e.g., `product.route.ts`).
4. **Update the route paths and imports** in the new file to reflect your new resource.

## 2. Implement the Handler (Controller)

1. **Locate the controllers or handlers directory** (e.g., `src/handlers/`).
2. **Create a new handler file** (e.g., `product.handler.ts`).
3. **Define handler functions** for your route (e.g., `createProduct`, `getProducts`).
4. **Export the handler functions** for use in your route file.

## 3. Register the Route in `app.ts`

1. **Open `app.ts`** in the project root.
2. **Import your new route file** at the top:
   ```typescript
   import productRoutes from './routes/product.route'
   ```
3. **Add your route to the routes variable**:
   ```typescript
   const routes = [
     homeRoute,
     healthRoute,
     phoneVerificationRoute,
     authRoute,
     productRoutes,
   ]
   ```
4. **Ensure the route path matches your API design.**

## 4. Test the New Route

1. **Start the development server.**
2. **Use Postman** to send requests to your new endpoint.
3. **Verify the handler functions are called and responses are correct.**

---

**Tip:** Always follow project naming conventions and keep your code modular.
