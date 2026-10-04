import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import IssuesPage from './pages/IssuesPage'
import RetestPage from './pages/RetestPage'
import VersionsPage from './pages/VersionsPage'
import ReportPage from './pages/ReportPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/retest" element={<RetestPage />} />
        <Route path="/versions" element={<VersionsPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
