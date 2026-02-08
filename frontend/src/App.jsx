import { BrowserRouter, Route, Routes } from "react-router-dom";
import Menu from "./pages/Menu.jsx";
import Home from "./pages/Home.jsx";
import Dollars from "./pages/Dollars.jsx";
import RegisterCustomer from "./pages/RegisterCustomer.jsx";
import ClientesLista from "./pages/ClientesLista.jsx";
import RegisterLoan from "./pages/RegisterLoan.jsx";
import RegisterPayment from "./pages/RegisterPayment.jsx";
import TestAuth from "./pages/TestAuth.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import PrestamosPorEstado from "./pages/PrestamosPorEstado.jsx";
import Reportes from "./pages/Reportes.jsx";
import Atesorado from "./pages/Atesorado.jsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prestamos"
          element={
            <ProtectedRoute>
              <Menu />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dolares"
          element={
            <ProtectedRoute allowedRoles={["dollars", "admin"]}>
              <Dollars />
            </ProtectedRoute>
          }
        />
        <Route
          path="/atesorado"
          element={
            <ProtectedRoute>
              <Atesorado />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prestamos/reportes"
          element={
            <ProtectedRoute>
              <Reportes />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clientes/nuevo"
          element={
            <ProtectedRoute>
              <RegisterCustomer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clientes"
          element={
            <ProtectedRoute>
              <ClientesLista />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prestamos/nuevo"
          element={
            <ProtectedRoute>
              <RegisterLoan />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prestamos/estado"
          element={
            <ProtectedRoute>
              <PrestamosPorEstado />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pagos/nuevo"
          element={
            <ProtectedRoute>
              <RegisterPayment />
            </ProtectedRoute>
          }
        />
        <Route
          path="/test-auth"
          element={
            <ProtectedRoute>
              <TestAuth />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
