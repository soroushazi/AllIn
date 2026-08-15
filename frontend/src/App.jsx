import { Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Layout from './Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Import from './pages/Import'
import Transactions from './pages/Transactions'
import Budgets from './pages/Budgets'
import Categories from './pages/Categories'
import Cards from './pages/Cards'
import Voice from './pages/Voice'
import FinancialFreedom from './pages/FinancialFreedom'
import Account from './pages/Account'

function Gate() {
  const { user } = useAuth()

  if (user === undefined) {
    return (
      <div className="login-screen">
        <p className="muted">Loading...</p>
      </div>
    )
  }

  if (user === null) {
    return <Login />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="import" element={<Import />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="categories" element={<Categories />} />
        <Route path="cards" element={<Cards />} />
        <Route path="voice" element={<Voice />} />
        <Route path="financial-freedom" element={<FinancialFreedom />} />
        <Route path="account" element={<Account />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
