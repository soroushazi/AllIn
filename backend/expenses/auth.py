from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

User = get_user_model()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Call once on app load so the browser has a csrftoken cookie to echo back
    as X-CSRFToken on the login POST."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie set"})


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username", "")
        password = request.data.get("password", "")
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response({"detail": "Invalid credentials"}, status=400)
        login(request, user)
        return Response({"id": user.id, "username": user.username})


class UsersView(APIView):
    """Both household accounts' current {id, username} - AllowAny since the
    Login screen needs this before a session exists, to render its
    Soroush/Shiva-style toggle from live data instead of a hardcoded pair
    (so a rename via ChangeUsernameView doesn't strand the login screen on
    a stale username). Ordered by id - stable and permanent since exactly
    two users are ever created, once - so the frontend can treat position
    0/1 as a fixed "slot" for anything that must survive a rename (colors,
    the YearlyExpense scope keys) without exposing anything sensitive."""

    permission_classes = [AllowAny]

    def get(self, request):
        users = User.objects.order_by("id").values("id", "username")
        return Response(list(users))


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=204)


class MeView(APIView):
    def get(self, request):
        return Response({"id": request.user.id, "username": request.user.username})


class ChangePasswordView(APIView):
    def post(self, request):
        current_password = request.data.get("current_password", "")
        new_password = request.data.get("new_password", "")

        if not request.user.check_password(current_password):
            return Response({"detail": "Current password is incorrect."}, status=400)

        try:
            validate_password(new_password, user=request.user)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages)}, status=400)

        request.user.set_password(new_password)
        request.user.save()
        # Session auth ties the session to a hash of the password - without
        # this, changing your own password would immediately log you out of
        # the very request that just changed it.
        update_session_auth_hash(request, request.user)
        return Response({"detail": "Password updated."})


class ChangeUsernameView(APIView):
    def post(self, request):
        # Normalized to lowercase - every "capitalize for display" spot in
        # the frontend assumes a lowercase stored username (matches the two
        # real accounts, soroush/shiva), and login itself is case-sensitive
        # against whatever's stored.
        new_username = request.data.get("new_username", "").strip().lower()
        if not new_username:
            return Response({"detail": "New username is required."}, status=400)

        try:
            User.username_validator(new_username)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages)}, status=400)

        if User.objects.exclude(pk=request.user.pk).filter(username__iexact=new_username).exists():
            return Response({"detail": "That username is already taken."}, status=400)

        request.user.username = new_username
        request.user.save(update_fields=["username"])
        # Session auth keys off the user's id, not username, so no
        # update_session_auth_hash needed here - the session stays valid.
        return Response({"id": request.user.id, "username": request.user.username})
