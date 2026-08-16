from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .auth import CsrfView, LoginView, LogoutView, MeView
from .views import (
    BudgetsSummaryView,
    CardViewSet,
    CategoryViewSet,
    IncomeViewSet,
    TransactionImportConfirmView,
    TransactionImportView,
    TransactionViewSet,
)

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("cards", CardViewSet, basename="card")
router.register("transactions", TransactionViewSet, basename="transaction")
router.register("income", IncomeViewSet, basename="income")

urlpatterns = [
    path("auth/csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("budgets/summary/", BudgetsSummaryView.as_view(), name="budgets-summary"),
    path("import/", TransactionImportView.as_view(), name="import"),
    path("import/confirm/", TransactionImportConfirmView.as_view(), name="import-confirm"),
    path("", include(router.urls)),
]
