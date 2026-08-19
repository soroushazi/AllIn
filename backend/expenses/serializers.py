from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Card, Category, Income, MerchantRule, NetWorthAccount, NetWorthEntry, Tag, Transaction, YearlyExpense
from .services import extract_merchant_keyword


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name"]


def get_or_create_tags(names):
    """Case-insensitive get-or-create per name, same spirit as
    get_or_create_category_from_label in services.py - reuses an existing
    tag regardless of casing (so "Hawaii" and "hawaii" don't split into two)
    but preserves whatever casing the first use established."""
    tags = []
    for raw in names:
        name = raw.strip()
        if not name:
            continue
        tag = Tag.objects.filter(name__iexact=name).first()
        if tag is None:
            tag = Tag.objects.create(name=name)
        tags.append(tag)
    return tags


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
    tags = serializers.ListField(child=serializers.CharField(), required=False, write_only=True)

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
            "notes",
            "location",
            "tags",
            "source",
        ]
        read_only_fields = ["owner", "card", "card_name", "date", "description", "amount", "source"]

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        rep["tags"] = [t.name for t in instance.tags.all()]
        return rep

    def update(self, instance, validated_data):
        tag_names = validated_data.pop("tags", None)
        instance = super().update(instance, validated_data)
        if tag_names is not None:
            instance.tags.set(get_or_create_tags(tag_names))
        return instance


class TransactionCreateSerializer(serializers.ModelSerializer):
    """A single, manually-typed transaction (Import screen's "Add
    transaction" tab, and the same form at the top of Transactions) - as
    opposed to the bulk, review-before-commit import pipeline. Unlike
    TransactionSerializer (used for editing an existing row), the core
    fields are writable here since this is what creates them."""

    owner = serializers.SlugRelatedField(slug_field="username", queryset=User.objects.all())
    tags = serializers.ListField(child=serializers.CharField(), required=False, write_only=True)
    # Both the Import/Transactions manual-add form and the Voice screen's
    # confirm-before-commit form post through this same serializer - "voice"
    # just tags the resulting row so it can be told apart later. Never
    # "import": bulk statement rows always go through commit_import_rows
    # instead, not this endpoint.
    source = serializers.ChoiceField(
        choices=[Transaction.Source.MANUAL, Transaction.Source.VOICE], required=False, write_only=True
    )

    class Meta:
        model = Transaction
        fields = ["id", "owner", "card", "date", "description", "amount", "category", "notes", "location", "tags", "source"]

    def validate(self, attrs):
        if attrs["card"].owner_id != attrs["owner"].id:
            raise serializers.ValidationError("Card must belong to the selected person.")
        return attrs

    def create(self, validated_data):
        tag_names = validated_data.pop("tags", [])
        validated_data["source"] = validated_data.pop("source", None) or Transaction.Source.MANUAL
        dedupe_key = Transaction.compute_dedupe_key(
            validated_data["owner"].id,
            validated_data["card"].id,
            validated_data["date"],
            validated_data["description"],
            validated_data["amount"],
        )
        if Transaction.objects.filter(dedupe_key=dedupe_key).exists():
            raise serializers.ValidationError(
                "A transaction with this exact date, description, and amount already exists on this card."
            )
        validated_data["dedupe_key"] = dedupe_key

        category = validated_data.get("category")
        transaction = Transaction.objects.create(**validated_data)
        if tag_names:
            transaction.tags.set(get_or_create_tags(tag_names))

        # Same "learn from corrections" behavior as recategorize() - picking
        # a category while manually adding a transaction should still teach
        # future imports of the same merchant, not just future manual adds.
        if category is not None:
            keyword = extract_merchant_keyword(transaction.description)
            if keyword:
                MerchantRule.objects.update_or_create(keyword=keyword, defaults={"category": category})

        return transaction

    def to_representation(self, instance):
        return TransactionSerializer(instance).data
