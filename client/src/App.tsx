import { Switch, Route, Redirect } from 'wouter'
import { LoginPage } from './pages/LoginPage'
import { PendingActivationPage } from './pages/PendingActivationPage'
import { DashboardPage } from './pages/DashboardPage'
import { ReviewListPage } from './pages/ReviewListPage'
import { ReviewEditorPage } from './pages/ReviewEditorPage'
import { TemplateListPage } from './pages/TemplateListPage'
import { TemplateEditorPage } from './pages/TemplateEditorPage'
import { CheckinPage } from './pages/CheckinPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { InstructorListPage } from './pages/InstructorListPage'
import { CompliancePage } from './pages/CompliancePage'
import { VolunteerHoursPage } from './pages/VolunteerHoursPage'
import { FeedbackPage } from './pages/FeedbackPage'
import { AdminFeedbackPage } from './pages/AdminFeedbackPage'
import { AdminReviewsPage } from './pages/AdminReviewsPage'
import { AdminReviewEditorPage } from './pages/AdminReviewEditorPage'
import { AboutPage } from './pages/AboutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { InstructorLayout } from './components/InstructorLayout'

function App() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/login" />
      </Route>
      <Route path="/login" component={LoginPage} />
      <Route path="/pending-activation" component={PendingActivationPage} />
      <Route path="/dashboard">
        <ProtectedRoute role="instructor">
          <InstructorLayout><DashboardPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/reviews">
        <ProtectedRoute role="instructor">
          <InstructorLayout><ReviewListPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/reviews/:id">
        <ProtectedRoute role="instructor">
          <InstructorLayout><ReviewEditorPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/templates">
        <ProtectedRoute role="instructor">
          <InstructorLayout><TemplateListPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/templates/new">
        <ProtectedRoute role="instructor">
          <InstructorLayout><TemplateEditorPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/templates/:id">
        <ProtectedRoute role="instructor">
          <InstructorLayout><TemplateEditorPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/checkin">
        <ProtectedRoute role="instructor">
          <InstructorLayout><CheckinPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/instructors">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <InstructorListPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/compliance">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <CompliancePage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/volunteer-hours">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <VolunteerHoursPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/feedback">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <AdminFeedbackPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/reviews/:id">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <AdminReviewEditorPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/reviews">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <AdminReviewsPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute role="admin">
          <AdminLayout>
            <AdminDashboardPage />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/about">
        <ProtectedRoute role="instructor">
          <InstructorLayout><AboutPage /></InstructorLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/about">
        <ProtectedRoute role="admin">
          <AdminLayout><AboutPage /></AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/feedback/:token" component={FeedbackPage} />
      <Route component={NotFoundPage} />
    </Switch>
  )
}

export default App
