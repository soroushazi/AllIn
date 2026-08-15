from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Card, Category, Income, Transaction


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
