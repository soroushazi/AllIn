from django.contrib import admin

from .models import Card, Category, ColumnMapping, Income, MerchantRule, Transaction


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "color", "weekly_budget", "monthly_budget"]


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "type"]
    list_filter = ["owner", "type"]


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ["date", "owner", "card", "description", "amount", "category", "source"]
    list_filter = ["owner", "card", "category", "source"]
    search_fields = ["description"]
    date_hierarchy = "date"


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
