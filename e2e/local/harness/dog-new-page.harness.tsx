// QA-SYNTH fixture-form harness: the REAL DogNewPage behind a real browser router, with
// Firebase-backed modules stubbed at bundle time (see dog-new-fixture-form.spec.ts).
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom'
import DogNewPage from '../../../src/pages/DogNewPage'

function DogDetailStub() {
  const { id } = useParams()
  const dog = (window as any).__harness.dogs.find((d: any) => d.id === id)
  return <h1>{dog?.name || 'not found'}</h1>
}

createRoot(document.querySelector('main')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/app/dogs/new" element={<DogNewPage toast={msg => (window as any).__harness.toasts.push(msg)} />} />
      <Route path="/app/dogs/:id" element={<DogDetailStub />} />
    </Routes>
  </BrowserRouter>,
)
