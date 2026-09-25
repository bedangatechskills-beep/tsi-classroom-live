import { Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import Home from './pages/Home'
import InstructorRoom from './pages/InstructorRoom'
import Present from './pages/Present'
import StudentRoom from './pages/StudentRoom'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <>
      {!isSupabaseConfigured && (
        <div className="banner" role="status">
          Supabase not configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in
          your project URL and anon key.
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<InstructorRoom />} />
        <Route path="/present/:code" element={<Present />} />
        <Route path="/r/:code" element={<StudentRoom />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
