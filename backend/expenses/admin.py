from django.contrib import admin

from .models import (
    Card,
    Category,
    ColumnMapping,
    Income,
    MerchantRule,
    NetWorthAccount,
    NetWorthEntry,
    Tag,
    Transaction,
    YearlyExpense,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "color", "weekly_budget", "monthly_budget"]


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "type"]
    list_filter = ["owner", "type"]


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ["date", "owner", "card", "description", "amount", "category", "location", "source"]
    list_filter = ["owner", "card", "category", "source"]
    search_fields = ["description", "location", "notes"]
    date_hierarchy = "date"


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name"]
    search_fields = ["name"]


@admin.register(ColumnMapping)
class ColumnMappingAdmin(admin.ModelAdmin):
    list_display = ["card", "date_column", "description_column", "amount_column", "flip_sign"]


@admin.register(MerchantRule)
class MerchantRuleAdmin(admin.ModelAdmin):
    list_display = ["keyword", "category"]
    search_fields = ["keyword"]


@admin.register(Income)
class IncomeAdmin(admin.ModelAdmin):
    list_display = ["date", "owner", "amount", "source"]
    list_filter = ["owner"]
    date_hierarchy = "date"


@admin.register(NetWorthAccount)
class NetWorthAccountAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "category"]
    list_filter = ["owner", "category"]


@admin.register(NetWorthEntry)
class NetWorthEntryAdmin(admin.ModelAdmin):
    list_display = ["account", "date", "balance"]
    list_filter = ["account__owner"]
    date_hierarchy = "date"


@admin.register(YearlyExpense)
class YearlyExpenseAdmin(admin.ModelAdmin):
    list_display = ["scope", "amount"]
