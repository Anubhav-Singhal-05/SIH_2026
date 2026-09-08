import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './store'
import Shell from './components/Layout'
import { ErrorBanner } from './components/Banners'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Identity from './pages/Identity'
import AssetList from './pages/AssetList'
import AssetDetail from './pages/AssetDetail'
import UploadWizard from './pages/UploadWizard'
import UpdateWizard from './pages/UpdateWizard'
import TransferWizard from './pages/TransferWizard'
import AccessManagement from './pages/AccessManagement'
import InheritanceSetup from './pages/InheritanceSetup'
import InheritanceActivation from './pages/InheritanceActivation'
import AuditLog from './pages/AuditLog'

function Protected({ children }) {
  const session = useStore((s) => s.session)
  const location = useLocation()
  if (!session) return <Navigate to='/login' state={{ from: location }} replace />
  return children
}

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBanner />
      <Routes>
        <Route path='/login' element={<Login />} />
        <Route path='/register' element={<Register />} />
        <Route path='/' element={<Protected><Shell><Dashboard /></Shell></Protected>} />
        <Route path='/dashboard' element={<Protected><Shell><Dashboard /></Shell></Protected>} />
        <Route path='/identity' element={<Protected><Shell><Identity /></Shell></Protected>} />
        <Route path='/assets' element={<Protected><Shell><AssetList /></Shell></Protected>} />
        <Route path='/assets/:assetId' element={<Protected><Shell><AssetDetail /></Shell></Protected>} />
        <Route path='/assets/upload' element={<Protected><Shell><UploadWizard /></Shell></Protected>} />
        <Route path='/assets/:assetId/update' element={<Protected><Shell><UpdateWizard /></Shell></Protected>} />
        <Route path='/assets/:assetId/transfer' element={<Protected><Shell><TransferWizard /></Shell></Protected>} />
        <Route path='/access' element={<Protected><Shell><AccessManagement /></Shell></Protected>} />
        <Route path='/access/:assetId' element={<Protected><Shell><AccessManagement /></Shell></Protected>} />
        <Route path='/inheritance' element={<Protected><Shell><InheritanceSetup /></Shell></Protected>} />
        <Route path='/inheritance/activation' element={<Protected><Shell><InheritanceActivation /></Shell></Protected>} />
        <Route path='/audit' element={<Protected><Shell><AuditLog /></Shell></Protected>} />
        <Route path='*' element={<Navigate to='/dashboard' replace />} />
      </Routes>
    </ErrorBoundary>
  )
}