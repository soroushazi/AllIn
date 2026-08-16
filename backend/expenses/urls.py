from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .auth import ChangePasswordView, ChangeUsernameView, CsrfView, LoginView, LogoutView, MeView, UsersView
from .views import (
    BudgetsSummaryView,
    CardViewSet,
    CategoryViewSet,
    FreedomSummaryView,
    IncomeViewSet,
    LocationsView,
    NetWorthAccountViewSet,
    NetWorthEntryViewSet,
    TagViewSet,
    TransactionImportConfirmView,
    TransactionImportView,
    TransactionViewSet,
    YearlyExpenseView,
)

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("cards", CardViewSet, basename="card")
router.register("transactions", TransactionViewSet, basename="transaction")
router.register("income", IncomeViewSet, basename="income")
router.register("tags", TagViewSet, basename="tag")
router.register("networth/accounts", NetWorthAccountViewSet, basename="networth-account")
router.register("networth/entries", NetWorthEntryViewSet, basename="networth-entry")

urlpatterns = [
    path("auth/csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("auth/change-username/", ChangeUsernameView.as_view(), name="auth-change-username"),
    path("auth/users/", UsersView.as_view(), name="auth-users"),
    path("budgets/summary/", BudgetsSummaryView.as_view(), name="budgets-summary"),
    path("networth/yearly-expense/", YearlyExpenseView.as_view(), name="networth-yearly-expense"),
    path("networth/summary/", FreedomSummaryView.as_view(), name="networth-summary"),
    path("import/", TransactionImportView.as_view(), name="import"),
    path("import/confirm/", TransactionImportConfirmView.as_view(), name="import-confirm"),
    path("locations/", LocationsView.as_view(), name="locations"),
    path("", include(router.urls)),
]
