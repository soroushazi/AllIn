import getpass
import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

USERNAMES = ["soroush", "shiva"]


class Command(BaseCommand):
    help = "Create the two household users (Soroush, Shiva). Safe to re-run - skips users that already exist."

    def add_arguments(self, parser):
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Read passwords from SOROUSH_PASSWORD / SHIVA_PASSWORD env vars instead of prompting.",
        )

    def handle(self, *args, **options):
        for username in USERNAMES:
            if User.objects.filter(username=username).exists():
                self.stdout.write(f"User '{username}' already exists, skipping.")
                continue

            password = self._get_password(username, options["noinput"])
            User.objects.create_superuser(username=username, email="", password=password)
            self.stdout.write(self.style.SUCCESS(f"Created user '{username}'"))

    def _get_password(self, username, noinput):
        if noinput:
            env_var = f"{username.upper()}_PASSWORD"
            password = os.environ.get(env_var)
            if not password:
                raise CommandError(f"--noinput requires {env_var} to be set")
            return password

        while True:
            password = getpass.getpass(f"Password for {username}: ")
            confirm = getpass.getpass(f"Confirm password for {username}: ")
            if password != confirm:
                self.stderr.write("Passwords didn't match, try again.")
                continue
            if not password:
                self.stderr.write("Password can't be empty.")
                continue
            return password
