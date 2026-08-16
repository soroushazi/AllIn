from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Card, Category, Income, NetWorthAccount, NetWorthEntry, Transaction, YearlyExpense


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "color", "weekly_budget", "monthly_budget"]


class CardSerializer(serializers.ModelSerializer):
    owner = serializers.SlugRelatedField(slug_field="username", queryset=User.objects.all())

    class Meta:
        model = Card
        fields = ["id", "owner", "name", "type", "header_row"]


class IncomeSerializer(serializers.ModelSerializer):
    owner = serializers.SlugRelatedField(slug_field="username", queryset=User.objects.all())

    class Meta:
        model = Income
        fields = ["id", "owner", "date", "amount", "source"]


class NetWorthAccountSerializer(serializers.ModelSerializer):
    owner = serializers.SlugRelatedField(slug_field="username", queryset=User.objects.all())
    is_liability = serializers.BooleanField(read_only=True)
    latest_balance = serializers.SerializerMethodField()
    latest_date = serializers.SerializerMethodField()

    class Meta:
        model = NetWorthAccount
        fields = ["id", "owner", "name", "category", "is_liability", "latest_balance", "latest_date"]

    def get_latest_balance(self, obj):
        latest = obj.entries.first()
        return latest.balance if latest else None

    def get_latest_date(self, obj):
        latest = obj.entries.first()
        return latest.date if latest else None


class NetWorthEntrySerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    owner = serializers.CharField(source="account.owner.username", read_only=True)

    class Meta:
        model = NetWorthEntry
        fields = ["id", "account", "account_name", "owner", "date", "balance"]


class YearlyExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = YearlyExpense
        fields = ["id", "scope", "amount"]


class TransactionSerializer(serializers.ModelSerializer):
    owner = serializers.CharField(source="owner.username", read_only=True)
    card_name = serializers.CharField(source="card.name", read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id",
            "owner",
            "card",
            "card_name",
            "date",
            "description",
            "amount",
            "category",
            "source",
        ]
        read_only_fields = ["owner", "card", "card_name", "date", "description", "amount", "source"]
